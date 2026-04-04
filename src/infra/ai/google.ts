import { GoogleGenAI } from '@google/genai';
import { ok, err } from '../../core/result';
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

      const response = await this.ai.models.generateContent({
        model: input.model,
        contents,
        config,
      });

      const content = response.text ?? '';
      const toolCalls: RunResult['toolCalls'] = [];

      if (response.functionCalls?.length) {
        for (const fc of response.functionCalls) {
          toolCalls.push({
            id: fc.name ?? `call_${Date.now()}`,
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

      const response = await this.ai.models.generateContentStream({
        model: input.model,
        contents,
        config,
      });

      for await (const chunk of response) {
        if (chunk.text) {
          yield { type: 'text_delta', data: { text: chunk.text } };
        }

        if (chunk.functionCalls?.length) {
          for (const fc of chunk.functionCalls) {
            const id = fc.name ?? `call_${Date.now()}`;
            yield { type: 'tool_call_start', data: { id, name: fc.name } };
            yield { type: 'tool_call_end', data: { id, name: fc.name, args: fc.args ?? {} } };
          }
        }
      }

      yield { type: 'done', data: {} };
    } catch (error) {
      yield { type: 'error', data: { error: error instanceof Error ? error.message : String(error) } };
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
