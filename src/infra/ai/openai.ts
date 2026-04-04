import OpenAI from 'openai';
import { logger } from '../../config/logger';
import { ok, err } from '../../core/result';
import { combinedAbortSignal } from '../../core/utils/abortController';
import { toOpenAITools, toOpenAIToolChoice } from './tool-format';
import { captureException } from '../observability/sentry';
import type { AgentRuntime, RunInput, RunResult, StreamEvent } from './types';
import type { Result } from '../../core/result';

export class OpenAIRawRuntime implements AgentRuntime {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? Bun.env.OPENAI_API_KEY });
  }

  async run(input: RunInput): Promise<Result<RunResult>> {
    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];

      if (input.systemPrompt) {
        messages.push({ role: 'system', content: input.systemPrompt });
      }

      for (const msg of input.messages) {
        if (msg.role === 'system') {
          messages.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : '' });
        } else if (msg.role === 'user') {
          messages.push({ role: 'user', content: typeof msg.content === 'string' ? msg.content : '' });
        } else if (msg.role === 'assistant') {
          const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
            role: 'assistant',
            content: typeof msg.content === 'string' ? msg.content : null,
          };
          if (typeof msg.content !== 'string') {
            const toolCalls = msg.content
              .filter((b) => b.type === 'tool_use')
              .map((b, i) => ({
                id: b.id!,
                type: 'function' as const,
                function: { name: b.name!, arguments: JSON.stringify(b.input ?? {}) },
              }));
            if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
          }
          messages.push(assistantMsg);
        } else if (msg.role === 'tool') {
          messages.push({
            role: 'tool',
            tool_call_id: msg.toolCallId!,
            content: typeof msg.content === 'string' ? msg.content : '',
          });
        }
      }

      const params: OpenAI.ChatCompletionCreateParams = {
        model: input.model,
        messages,
      };

      if (input.temperature !== undefined) params.temperature = input.temperature;
      if (input.tools?.length) params.tools = toOpenAITools(input.tools);
      if (input.toolChoice && input.tools?.length) {
        params.tool_choice = toOpenAIToolChoice(input.toolChoice) as any;
      }
      if (input.disableParallelToolUse) {
        (params as any).parallel_tool_calls = false;
      }

      // Use max_completion_tokens for newer models, max_tokens for older
      if (input.maxTokens) {
        const isNewer = /^(gpt-4o|o[1-9])/.test(input.model);
        if (isNewer) {
          (params as any).max_completion_tokens = input.maxTokens;
        } else {
          params.max_tokens = input.maxTokens;
        }
      }

      const response = await this.client.chat.completions.create(params, { signal: input.signal });
      const choice = response.choices[0];
      if (!choice) return err(new Error('No choices in OpenAI response'));

      const message = choice.message;
      const content = message.content ?? '';
      const toolCalls = message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || '{}'),
      }));

      const stopReason: RunResult['stopReason'] =
        choice.finish_reason === 'stop' ? 'end_turn'
        : choice.finish_reason === 'tool_calls' ? 'tool_use'
        : choice.finish_reason === 'length' ? 'max_tokens'
        : 'end_turn';

      return ok({
        content,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        usage: response.usage
          ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
          : undefined,
        stopReason,
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

      const messages: OpenAI.ChatCompletionMessageParam[] = [];
      if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
      for (const msg of input.messages) {
        if (msg.role === 'tool') {
          messages.push({ role: 'tool', tool_call_id: msg.toolCallId!, content: typeof msg.content === 'string' ? msg.content : '' });
        } else {
          messages.push({ role: msg.role as 'user' | 'assistant' | 'system', content: typeof msg.content === 'string' ? msg.content : '' });
        }
      }

      const params: OpenAI.ChatCompletionCreateParams = {
        model: input.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (input.temperature !== undefined) params.temperature = input.temperature;
      if (input.tools?.length) params.tools = toOpenAITools(input.tools);
      if (input.toolChoice && input.tools?.length) {
        (params as any).tool_choice = toOpenAIToolChoice(input.toolChoice);
      }
      if (input.disableParallelToolUse) {
        (params as any).parallel_tool_calls = false;
      }

      const stream = await this.client.chat.completions.create(params, { signal: combinedSignal });

      const toolCallAccumulators = new Map<number, { id: string; name: string; argsJson: string }>();

      for await (const chunk of stream as AsyncIterable<OpenAI.ChatCompletionChunk>) {
        kick();
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text_delta', data: { text: delta.content } };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              toolCallAccumulators.set(tc.index, { id: tc.id ?? '', name: tc.function.name, argsJson: '' });
              yield { type: 'tool_call_start', data: { id: tc.id, name: tc.function.name } };
            }
            if (tc.function?.arguments) {
              const acc = toolCallAccumulators.get(tc.index);
              if (acc) acc.argsJson += tc.function.arguments;
              yield { type: 'tool_call_delta', data: { delta: tc.function.arguments } };
            }
          }
        }

        if (chunk.choices[0]?.finish_reason) {
          // Flush any accumulated tool calls
          for (const [idx, acc] of toolCallAccumulators) {
            let args: unknown = {};
            try { args = JSON.parse(acc.argsJson); } catch { logger.warn({ toolCallId: acc.id, toolName: acc.name, rawArgs: acc.argsJson.slice(0, 500) }, 'Failed to parse tool call args from stream, using empty args'); }
            yield { type: 'tool_call_end', data: { id: acc.id, name: acc.name, args } };
          }
          toolCallAccumulators.clear();
          const fr = chunk.choices[0].finish_reason;
          const stopReason = fr === 'tool_calls' ? 'tool_use'
            : fr === 'length' ? 'max_tokens'
            : 'end_turn';
          const usage = (chunk as any).usage
            ? { inputTokens: (chunk as any).usage.prompt_tokens as number, outputTokens: (chunk as any).usage.completion_tokens as number }
            : undefined;
          yield { type: 'done', data: { usage, stopReason } };
        }
      }
    } catch (err) {
      if (watchdogController.signal.aborted) {
        yield { type: 'error', data: { error: `Stream watchdog timeout after ${watchdogMs}ms` } };
      } else {
        captureException(err, { provider: 'openai', streaming: true });
        yield { type: 'error', data: { error: err instanceof Error ? err.message : String(err) } };
      }
    } finally {
      if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
    }
  }
}
