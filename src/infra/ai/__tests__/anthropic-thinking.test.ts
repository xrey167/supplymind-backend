import { describe, it, expect } from 'bun:test';
import { AnthropicRawRuntime } from '../anthropic';

describe('AnthropicRawRuntime extended thinking', () => {
  it('passes thinking params when thinkingBudget > 0', async () => {
    let capturedParams: any = null;

    const runtime = new AnthropicRawRuntime('test-key');
    (runtime as any).client = {
      messages: {
        create: async (params: any) => {
          capturedParams = params;
          return {
            content: [{ type: 'thinking', thinking: 'reasoning...' }, { type: 'text', text: 'answer' }],
            usage: { input_tokens: 100, output_tokens: 50 },
            stop_reason: 'end_turn',
          };
        },
      },
    };

    const result = await runtime.run({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'think hard' }],
      thinkingBudget: 10000,
      temperature: 0.5,
      maxTokens: 4096,
    });

    expect(capturedParams.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
    expect(capturedParams.temperature).toBe(1); // forced to 1
    expect(capturedParams.max_tokens).toBeUndefined(); // deleted
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('answer'); // thinking block skipped
    }
  });

  it('does not pass thinking params when thinkingBudget is 0', async () => {
    let capturedParams: any = null;

    const runtime = new AnthropicRawRuntime('test-key');
    (runtime as any).client = {
      messages: {
        create: async (params: any) => {
          capturedParams = params;
          return {
            content: [{ type: 'text', text: 'answer' }],
            usage: { input_tokens: 100, output_tokens: 50 },
            stop_reason: 'end_turn',
          };
        },
      },
    };

    await runtime.run({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinkingBudget: 0,
      temperature: 0.5,
      maxTokens: 4096,
    });

    expect(capturedParams.thinking).toBeUndefined();
    expect(capturedParams.temperature).toBe(0.5);
    expect(capturedParams.max_tokens).toBe(4096);
  });

  it('does not pass thinking params when thinkingBudget is omitted', async () => {
    let capturedParams: any = null;

    const runtime = new AnthropicRawRuntime('test-key');
    (runtime as any).client = {
      messages: {
        create: async (params: any) => {
          capturedParams = params;
          return {
            content: [{ type: 'text', text: 'answer' }],
            usage: { input_tokens: 100, output_tokens: 50 },
            stop_reason: 'end_turn',
          };
        },
      },
    };

    await runtime.run({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(capturedParams.thinking).toBeUndefined();
  });

  it('streams thinking_delta events', async () => {
    const runtime = new AnthropicRawRuntime('test-key');
    (runtime as any).client = {
      messages: {
        stream: () => ({
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'step 1' } };
            yield { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } };
            yield { type: 'message_stop' };
          },
        }),
      },
    };

    const events: any[] = [];
    for await (const event of runtime.stream({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'think' }],
      thinkingBudget: 5000,
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: 'thinking_delta', data: { thinking: 'step 1' } });
    expect(events[1]).toEqual({ type: 'text_delta', data: { text: 'answer' } });
  });
});
