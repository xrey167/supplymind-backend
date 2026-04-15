import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

// ---- OpenAI SDK mock ----

// We'll build per-test implementations via these holders
let mockCreate: ReturnType<typeof mock>;

mockCreate = mock(async () => ({}));

mock.module('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: (...args: unknown[]) => mockCreate(...args),
        },
      };
    },
  };
});

// ---- Supporting mocks ----
mock.module('../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module('./tool-format', () => ({
  toOpenAITools: (tools: unknown) => tools,
  toOpenAIToolChoice: (choice: unknown) => choice,
}));

mock.module('../observability/sentry', () => ({
  captureException: mock(() => {}),
}));

mock.module('../../core/utils/abortController', () => ({
  combinedAbortSignal: (signals: AbortSignal[]) => signals[0] ?? new AbortController().signal,
}));

// Import after mocks
const { OpenAIRawRuntime } = await import('../openai');

// ---- Helpers ----

function makeRunInput(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    ...overrides,
  };
}

/** Build an async iterable from an array of chunks */
async function* makeChunkStream(chunks: unknown[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('OpenAIRawRuntime', () => {
  let runtime: InstanceType<typeof OpenAIRawRuntime>;

  beforeEach(() => {
    runtime = new OpenAIRawRuntime('test-key');
    mockCreate.mockClear();
  });

  describe('run()', () => {
    it('returns correct content from a non-streaming response', async () => {
      mockCreate.mockImplementationOnce(async () => ({
        choices: [
          {
            message: { role: 'assistant', content: 'Hello back!', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      const result = await runtime.run(makeRunInput());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello back!');
        expect(result.value.stopReason).toBe('end_turn');
        expect(result.value.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
      }
    });

    it('returns err when choices array is empty', async () => {
      mockCreate.mockImplementationOnce(async () => ({ choices: [] }));

      const result = await runtime.run(makeRunInput());

      expect(result.ok).toBe(false);
    });

    it('maps finish_reason tool_calls to stopReason tool_use', async () => {
      mockCreate.mockImplementationOnce(async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'tc-1', type: 'function', function: { name: 'myTool', arguments: '{"x":1}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }));

      const result = await runtime.run(makeRunInput());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stopReason).toBe('tool_use');
        expect(result.value.toolCalls).toHaveLength(1);
        expect(result.value.toolCalls![0].name).toBe('myTool');
        expect(result.value.toolCalls![0].args).toEqual({ x: 1 });
      }
    });

    it('returns err when create throws', async () => {
      mockCreate.mockImplementationOnce(async () => { throw new Error('API error'); });

      const result = await runtime.run(makeRunInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('API error');
      }
    });
  });

  describe('stream()', () => {
    it('emits text_delta events for content chunks', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
        { choices: [{ delta: { content: ' world' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 8 } },
      ];

      mockCreate.mockImplementationOnce(async () => makeChunkStream(chunks));

      const events: Array<{ type: string; data: unknown }> = [];
      for await (const event of runtime.stream(makeRunInput())) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === 'text_delta');
      expect(textDeltas).toHaveLength(2);
      expect((textDeltas[0].data as { text: string }).text).toBe('Hello');
      expect((textDeltas[1].data as { text: string }).text).toBe(' world');
    });

    it('done event carries usage when final chunk has usage', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hi' }, finish_reason: null }] },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        },
      ];

      mockCreate.mockImplementationOnce(async () => makeChunkStream(chunks));

      const events: Array<{ type: string; data: unknown }> = [];
      for await (const event of runtime.stream(makeRunInput())) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      const doneData = doneEvent!.data as { usage?: { inputTokens: number; outputTokens: number }; stopReason: string };
      expect(doneData.stopReason).toBe('end_turn');
      expect(doneData.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    });

    it('done event has undefined usage when final chunk has no usage', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hi' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ];

      mockCreate.mockImplementationOnce(async () => makeChunkStream(chunks));

      const events: Array<{ type: string; data: unknown }> = [];
      for await (const event of runtime.stream(makeRunInput())) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      const doneData = doneEvent!.data as { usage?: unknown };
      expect(doneData.usage).toBeUndefined();
    });

    it('emits error event when stream throws', async () => {
      mockCreate.mockImplementationOnce(async () => { throw new Error('Network failure'); });

      const events: Array<{ type: string; data: unknown }> = [];
      for await (const event of runtime.stream(makeRunInput())) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as { error: string }).error).toContain('Network failure');
    });

    it('emits tool_call_start and tool_call_end events', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: 'tc-1', function: { name: 'searchTool', arguments: '' } }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"q":"foo"}' } }],
            },
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3 } },
      ];

      mockCreate.mockImplementationOnce(async () => makeChunkStream(chunks));

      const events: Array<{ type: string; data: unknown }> = [];
      for await (const event of runtime.stream(makeRunInput())) {
        events.push(event);
      }

      expect(events.some((e) => e.type === 'tool_call_start')).toBe(true);
      expect(events.some((e) => e.type === 'tool_call_end')).toBe(true);

      const endEvent = events.find((e) => e.type === 'tool_call_end');
      expect((endEvent!.data as { name: string }).name).toBe('searchTool');
      expect((endEvent!.data as { args: unknown }).args).toEqual({ q: 'foo' });

      const doneEvent = events.find((e) => e.type === 'done');
      expect((doneEvent!.data as { stopReason: string }).stopReason).toBe('tool_use');
    });
  });
});

afterAll(() => mock.restore());
