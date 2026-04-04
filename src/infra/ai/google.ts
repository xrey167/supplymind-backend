import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import { ok, err } from '../../core/result';
import { AbortError } from '../../core/errors';
import { combinedAbortSignal } from '../../core/utils/abortController';
import { toGoogleTools, toGoogleToolConfig } from './tool-format';
import type { AgentRuntime, RunInput, RunResult, StreamEvent } from './types';
import type { Result } from '../../core/result';

export class GoogleRawRuntime implements AgentRuntime {
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    this.ai = new GoogleGenAI({ apiKey: apiKey ?? process.env.GOOGLE_API_KEY ?? '' });
  }

  async run(input: RunInput): Promise<Result<RunResult>> {
    try {
      const contents = this.convertMessages(input);

      const config: Record<string, unknown> = {};
      if (input.temperature !== undefined) config.temperature = input.temperature;
      if (input.maxTokens) config.maxOutputTokens = input.maxTokens;
      if (input.systemPrompt) config.systemInstruction = input.systemPrompt;
      if (input.tools?.length) config.tools = toGoogleTools(input.tools);
      if (input.toolChoice && input.tools?.length) {
        config.toolConfig = toGoogleToolConfig(input.toolChoice);
      }

      const generateCall = this.ai.models.generateContent({
        model: input.model,
        contents,
        config,
      });
      const response = await (input.signal
        ? Promise.race([
            generateCall,
            new Promise<never>((_, reject) =>
              input.signal!.addEventListener(
                'abort',
                () => reject(new AbortError('Aborted', 'user')),
                { once: true },
              ),
            ),
          ])
        : generateCall);

      const content = response.text ?? '';
      const toolCalls: RunResult['toolCalls'] = [];

      if (response.functionCalls?.length) {
        for (const fc of response.functionCalls) {
          toolCalls.push({
            id: nanoid(),
            name: fc.name ?? '',
            args: fc.args ?? {},
          });
        }
      }

      const stopReason: RunResult['stopReason'] =
        toolCalls.length > 0 ? 'tool_use' : 'end_turn';

      return ok({
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: response.usageMetadata
          ? {
              inputTokens: response.usageMetadata.promptTokenCount ?? 0,
              outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
            }
          : undefined,
        stopReason,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async *stream(input: RunInput): AsyncIterable<StreamEvent> {
    const watchdogMs = parseInt(process.env.STREAM_WATCHDOG_MS ?? '90000', 10);
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

      const contents = this.convertMessages(input);

      const config: Record<string, unknown> = {};
      if (input.temperature !== undefined) config.temperature = input.temperature;
      if (input.maxTokens) config.maxOutputTokens = input.maxTokens;
      if (input.systemPrompt) config.systemInstruction = input.systemPrompt;
      if (input.tools?.length) config.tools = toGoogleTools(input.tools);
      if (input.toolChoice && input.tools?.length) {
        config.toolConfig = toGoogleToolConfig(input.toolChoice);
      }

      // Google GenAI does not accept a signal natively; use Promise.race for abort support
      const streamCall = this.ai.models.generateContentStream({
        model: input.model,
        contents,
        config,
      });
      const response = await Promise.race([
        streamCall,
        new Promise<never>((_, reject) =>
          combinedSignal.addEventListener(
            'abort',
            () => reject(combinedSignal.reason instanceof Error
              ? combinedSignal.reason
              : new AbortError('Aborted', 'user')),
            { once: true },
          ),
        ),
      ]);

      const iterator = response[Symbol.asyncIterator]();

      while (true) {
        // Check abort synchronously before each chunk to avoid creating a new Promise per iteration
        if (combinedSignal.aborted) {
          throw combinedSignal.reason instanceof Error
            ? combinedSignal.reason
            : new AbortError('Aborted', 'user');
        }
        const next = await iterator.next();

        if (next.done) break;

        kick(); // reset watchdog on each chunk
        const chunk = next.value;

        if (chunk.text) {
          yield { type: 'text_delta', data: { text: chunk.text } };
        }

        if (chunk.functionCalls?.length) {
          for (const fc of chunk.functionCalls) {
            const id = nanoid();
            yield { type: 'tool_call_start', data: { id, name: fc.name } };
            yield { type: 'tool_call_end', data: { id, name: fc.name, args: fc.args ?? {} } };
          }
        }
      }

      yield { type: 'done', data: {} };
    } catch (err) {
      if (watchdogController.signal.aborted) {
        yield { type: 'error', data: { error: `Stream watchdog timeout after ${watchdogMs}ms` } };
      } else {
        yield { type: 'error', data: { error: err instanceof Error ? err.message : String(err) } };
      }
    } finally {
      if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
    }
  }

  private convertMessages(input: RunInput) {
    return input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: typeof m.content === 'string'
          ? [{ text: m.content }]
          : m.content.map((block) => {
              if (block.type === 'text') return { text: block.text ?? '' };
              if (block.type === 'tool_use')
                return { functionCall: { name: block.name ?? '', args: (block.input ?? {}) as Record<string, unknown> } };
              return {
                functionResponse: {
                  name: block.toolUseId ?? '',
                  response: { result: block.content ?? '' },
                },
              };
            }),
      }));
  }
}
