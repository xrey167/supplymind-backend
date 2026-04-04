import Anthropic from '@anthropic-ai/sdk';
import { ok, err } from '../../core/result';
import { toAnthropicTools, toAnthropicToolChoice } from './tool-format';
import type { AgentRuntime, RunInput, RunResult, StreamEvent } from './types';
import type { Result } from '../../core/result';

export type ToolExecutor = (name: string, args: unknown) => Promise<unknown>;

export class AnthropicAgentSdkRuntime implements AgentRuntime {
  private client: Anthropic;
  private toolExecutor?: ToolExecutor;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? Bun.env.ANTHROPIC_API_KEY });
  }

  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  async run(input: RunInput): Promise<Result<RunResult>> {
    try {
      const messages: Anthropic.MessageParam[] = input.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string' ? m.content : m.content.map(block => {
            if (block.type === 'text') return { type: 'text' as const, text: block.text! };
            if (block.type === 'tool_use') return { type: 'tool_use' as const, id: block.id!, name: block.name!, input: block.input ?? {} };
            return { type: 'tool_result' as const, tool_use_id: block.toolUseId!, content: block.content ?? '' };
          }),
        }));

      const tools = input.tools ? toAnthropicTools(input.tools) : [];
      const maxIterations = 10;

      for (let i = 0; i < maxIterations; i++) {
        // Compute tool_choice, merging disableParallelToolUse into the same object
        let toolChoiceParam: Record<string, unknown> | undefined;
        if (input.toolChoice && input.tools?.length) {
          toolChoiceParam = toAnthropicToolChoice(input.toolChoice) as Record<string, unknown>;
        }
        if (input.disableParallelToolUse !== undefined) {
          toolChoiceParam = {
            ...(toolChoiceParam ?? { type: 'auto' }),
            disable_parallel_tool_use: input.disableParallelToolUse,
          };
        }

        const response = await this.client.messages.create({
          model: input.model,
          max_tokens: input.maxTokens ?? 4096,
          temperature: input.temperature,
          system: input.systemPrompt,
          messages,
          tools: tools as any,
          ...(toolChoiceParam ? { tool_choice: toolChoiceParam } : {}),
        } as any);

        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

        if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0 && this.toolExecutor) {
          messages.push({ role: 'assistant', content: response.content as any });

          const toolResults: Anthropic.MessageParam = {
            role: 'user',
            content: await Promise.all(toolUseBlocks.map(async (block) => {
              try {
                const result = await this.toolExecutor!(block.name, block.input);
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: typeof result === 'string' ? result : JSON.stringify(result),
                };
              } catch (error) {
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                  is_error: true,
                };
              }
            })),
          };
          messages.push(toolResults);
          continue;
        }

        const textContent = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
        return ok({
          content: textContent,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
          stopReason: response.stop_reason === 'end_turn' ? 'end_turn'
            : response.stop_reason === 'tool_use' ? 'tool_use'
            : response.stop_reason === 'max_tokens' ? 'max_tokens'
            : (response.stop_reason as string) === 'pause_turn' ? 'pause_turn'
            : 'end_turn',
        });
      }

      return ok({ content: 'Max tool call iterations reached', stopReason: 'end_turn' as const });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async *stream(input: RunInput): AsyncIterable<StreamEvent> {
    try {
      const result = await this.run(input);
      if (result.ok) {
        yield { type: 'text_delta', data: { text: result.value.content } };
        yield { type: 'done', data: {} };
      } else {
        yield { type: 'error', data: { error: result.error.message } };
      }
    } catch (error) {
      yield { type: 'error', data: { error: error instanceof Error ? error.message : String(error) } };
    }
  }
}
