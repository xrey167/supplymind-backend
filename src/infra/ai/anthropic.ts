import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../config/logger';
import { ok, err } from '../../core/result';
import { combinedAbortSignal } from '../../core/utils/abortController';
import { toAnthropicTools, toAnthropicToolChoice } from './tool-format';
import { captureException } from '../observability/sentry';
import type { AgentRuntime, RunInput, RunResult, StreamEvent } from './types';
import type { Result } from '../../core/result';

export class AnthropicRawRuntime implements AgentRuntime {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? Bun.env.ANTHROPIC_API_KEY });
  }

  async run(input: RunInput): Promise<Result<RunResult>> {
    try {
      const params: Anthropic.MessageCreateParams = {
        model: input.model,
        max_tokens: input.maxTokens ?? 4096,
        messages: input.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: typeof m.content === 'string'
              ? m.content
              : m.content.map((block) => {
                  if (block.type === 'text') return { type: 'text' as const, text: block.text! };
                  if (block.type === 'tool_use')
                    return { type: 'tool_use' as const, id: block.id!, name: block.name!, input: block.input ?? {} };
                  return {
                    type: 'tool_result' as const,
                    tool_use_id: block.toolUseId!,
                    content: Array.isArray(block.content)
                      ? block.content.map((b) => ({ type: 'image' as const, source: b.source }))
                      : (block.content ?? ''),
                    is_error: block.isError,
                  };
                }),
          })),
      };

      if (input.systemPrompt) {
        params.system = input.systemPrompt;
      }
      if (input.temperature !== undefined) {
        params.temperature = input.temperature;
      }
      if (input.tools?.length) {
        params.tools = toAnthropicTools(input.tools) as Anthropic.Tool[];
      }
      if (input.toolChoice && input.tools?.length) {
        (params as any).tool_choice = toAnthropicToolChoice(input.toolChoice);
      }
      if (input.disableParallelToolUse !== undefined) {
        (params as any).tool_choice = {
          ...((params as any).tool_choice ?? { type: 'auto' }),
          disable_parallel_tool_use: input.disableParallelToolUse,
        };
      }

      const hasBetaTools = input.tools?.some(t => t.betaType) ?? false;
      const response = hasBetaTools
        ? await this.client.beta.messages.create(
            { ...params, betas: ['computer-use-2025-11-24'] } as any,
            { signal: input.signal },
          )
        : await this.client.messages.create(params, { signal: input.signal });

      let content = '';
      const toolCalls: RunResult['toolCalls'] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, args: block.input });
        }
      }

      const stopReason = response.stop_reason === 'end_turn'
        ? 'end_turn'
        : response.stop_reason === 'tool_use'
          ? 'tool_use'
          : response.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : (response.stop_reason as string) === 'pause_turn'
              ? 'pause_turn'
              : 'end_turn';

      return ok({
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        stopReason: stopReason as RunResult['stopReason'],
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async *stream(input: RunInput): AsyncIterable<StreamEvent> {
    const watchdogMs = parseInt(Bun.env.STREAM_WATCHDOG_MS ?? '90000', 10);
    const watchdogController = new AbortController();
    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;

    const kick = () => {
      if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        watchdogController.abort(new Error(`Stream watchdog: no chunk received for ${watchdogMs}ms`));
      }, watchdogMs);
    };

    const combinedSignal = combinedAbortSignal(
      [watchdogController.signal, ...(input.signal ? [input.signal] : [])],
    );

    try {
      kick();

      const params: Anthropic.MessageCreateParams = {
        model: input.model,
        max_tokens: input.maxTokens ?? 4096,
        messages: input.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: typeof m.content === 'string' ? m.content : (m.content as any),
          })),
        stream: true,
      };

      if (input.systemPrompt) params.system = input.systemPrompt;
      if (input.temperature !== undefined) params.temperature = input.temperature;
      if (input.tools?.length) params.tools = toAnthropicTools(input.tools) as Anthropic.Tool[];
      if (input.toolChoice && input.tools?.length) {
        (params as any).tool_choice = toAnthropicToolChoice(input.toolChoice);
      }
      if (input.disableParallelToolUse !== undefined) {
        (params as any).tool_choice = {
          ...((params as any).tool_choice ?? { type: 'auto' }),
          disable_parallel_tool_use: input.disableParallelToolUse,
        };
      }

      const hasBetaTools = input.tools?.some(t => t.betaType) ?? false;
      const stream = hasBetaTools
        ? this.client.beta.messages.stream(
            { ...params, betas: ['computer-use-2025-11-24'] } as any,
            { signal: combinedSignal },
          )
        : this.client.messages.stream(params, { signal: combinedSignal });

      // Track tool_use blocks for tool_call_end
      const toolBlocks = new Map<number, { id: string; name: string; argsJson: string }>();
      let doneUsage = { inputTokens: 0, outputTokens: 0 };
      let doneStopReason: string | undefined;

      for await (const event of stream) {
        kick();
        if (event.type === 'message_start') {
          const msgStart = event as any;
          if (msgStart.message?.usage?.input_tokens !== undefined) {
            doneUsage.inputTokens = msgStart.message.usage.input_tokens;
          }
        } else if (event.type === 'message_delta') {
          const msgDelta = event as any;
          if (msgDelta.usage?.output_tokens !== undefined) {
            doneUsage.outputTokens = msgDelta.usage.output_tokens;
          }
          if (msgDelta.delta?.stop_reason) {
            const sr = msgDelta.delta.stop_reason as string;
            doneStopReason = sr === 'tool_use' ? 'tool_use'
              : sr === 'max_tokens' ? 'max_tokens'
              : 'end_turn';
          }
        } else if (event.type === 'content_block_start') {
          const block = (event as any).content_block;
          if (block?.type === 'tool_use') {
            toolBlocks.set((event as any).index, { id: block.id, name: block.name, argsJson: '' });
            yield { type: 'tool_call_start', data: { id: block.id, name: block.name } };
          }
        } else if (event.type === 'content_block_delta') {
          const delta = (event as any).delta;
          if (delta?.type === 'text_delta') {
            yield { type: 'text_delta', data: { text: delta.text } };
          } else if (delta?.type === 'input_json_delta') {
            const tracked = toolBlocks.get((event as any).index);
            if (tracked) tracked.argsJson += delta.partial_json;
            yield { type: 'tool_call_delta', data: { delta: delta.partial_json } };
          }
        } else if (event.type === 'content_block_stop') {
          const tracked = toolBlocks.get((event as any).index);
          if (tracked) {
            let args: unknown = {};
            try { args = JSON.parse(tracked.argsJson); } catch { logger.warn({ toolCallId: tracked.id, toolName: tracked.name, rawArgs: tracked.argsJson.slice(0, 500) }, 'Failed to parse tool call args from stream, using empty args'); }
            yield { type: 'tool_call_end', data: { id: tracked.id, name: tracked.name, args } };
            toolBlocks.delete((event as any).index);
          }
        } else if (event.type === 'message_stop') {
          yield { type: 'done', data: { usage: doneUsage, stopReason: doneStopReason } };
        }
      }
    } catch (err) {
      if (watchdogController.signal.aborted) {
        yield { type: 'error', data: { error: `Stream watchdog timeout after ${watchdogMs}ms` } };
      } else {
        captureException(err, { provider: 'anthropic', streaming: true });
        yield { type: 'error', data: { error: err instanceof Error ? err.message : String(err) } };
      }
    } finally {
      if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
    }
  }
}
