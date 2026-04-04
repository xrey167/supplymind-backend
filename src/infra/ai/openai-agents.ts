import OpenAI from 'openai';
import { ok, err } from '../../core/result';
import { toOpenAITools } from './tool-format';
import type { AgentRuntime, RunInput, RunResult, StreamEvent } from './types';
import type { Result } from '../../core/result';

export type ToolExecutor = (name: string, args: unknown) => Promise<unknown>;

export class OpenAIAgentSdkRuntime implements AgentRuntime {
  private client: OpenAI;
  private toolExecutor?: ToolExecutor;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  async run(input: RunInput): Promise<Result<RunResult>> {
    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = input.messages.map(m => {
        if (m.role === 'system') return { role: 'system' as const, content: typeof m.content === 'string' ? m.content : '' };
        if (m.role === 'tool') return { role: 'tool' as const, content: typeof m.content === 'string' ? m.content : '', tool_call_id: m.toolCallId ?? '' };
        if (m.role === 'assistant') return { role: 'assistant' as const, content: typeof m.content === 'string' ? m.content : '' };
        return { role: 'user' as const, content: typeof m.content === 'string' ? m.content : '' };
      });

      if (input.systemPrompt) {
        messages.unshift({ role: 'system', content: input.systemPrompt });
      }

      const tools = input.tools ? toOpenAITools(input.tools) : undefined;
      const maxIterations = 10;

      for (let i = 0; i < maxIterations; i++) {
        const response = await this.client.chat.completions.create({
          model: input.model,
          temperature: input.temperature,
          max_completion_tokens: input.maxTokens,
          messages,
          tools: tools?.length ? tools : undefined,
        });

        const choice = response.choices[0];
        if (!choice) return err(new Error('No response from OpenAI'));

        if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length && this.toolExecutor) {
          messages.push(choice.message);

          for (const toolCall of choice.message.tool_calls) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              const result = await this.toolExecutor(toolCall.function.name, args);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
              });
            } catch (error) {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }
          continue;
        }

        return ok({
          content: choice.message.content ?? '',
          usage: response.usage ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          } : undefined,
          stopReason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
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
