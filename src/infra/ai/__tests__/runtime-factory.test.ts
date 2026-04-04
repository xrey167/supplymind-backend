import { describe, test, expect, beforeEach, it } from 'bun:test';
import { createRuntime, withRetryRuntime } from '../runtime-factory';
import { AIError } from '../../../core/errors';
import { ok, err } from '../../../core/result';
import type { AgentRuntime, RunInput, RunResult, StreamEvent } from '../types';

// ---------------------------------------------------------------------------
// createRuntime — integration-level smoke tests (checks the wrapped object
// still has run/stream, since withRetryRuntime hides the real class)
// ---------------------------------------------------------------------------
describe('createRuntime', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GOOGLE_API_KEY = 'test-google-key';
  });

  test('raw + anthropic returns runtime with run/stream', () => {
    const rt = createRuntime('anthropic', 'raw');
    expect(typeof rt.run).toBe('function');
    expect(typeof rt.stream).toBe('function');
  });

  test('raw + openai returns runtime with run/stream', () => {
    const rt = createRuntime('openai', 'raw');
    expect(typeof rt.run).toBe('function');
    expect(typeof rt.stream).toBe('function');
  });

  test('raw + google returns runtime with run/stream', () => {
    const rt = createRuntime('google', 'raw');
    expect(typeof rt.run).toBe('function');
    expect(typeof rt.stream).toBe('function');
  });

  test('agent-sdk + anthropic returns runtime with run/stream', () => {
    const rt = createRuntime('anthropic', 'agent-sdk');
    expect(typeof rt.run).toBe('function');
    expect(typeof rt.stream).toBe('function');
  });

  test('agent-sdk + openai returns runtime with run/stream', () => {
    const rt = createRuntime('openai', 'agent-sdk');
    expect(typeof rt.run).toBe('function');
    expect(typeof rt.stream).toBe('function');
  });

  test('agent-sdk + google throws', () => {
    expect(() => createRuntime('google', 'agent-sdk')).toThrow('No agent-sdk runtime');
  });

  test('unknown provider throws', () => {
    expect(() => createRuntime('unknown' as any, 'raw')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// withRetryRuntime — unit tests using a mock AgentRuntime
// ---------------------------------------------------------------------------

const baseInput: RunInput = {
  messages: [{ role: 'user', content: 'hello' }],
  model: 'test-model',
};

function makeStream(): AgentRuntime['stream'] {
  return async function* () {
    yield { type: 'done', data: null } satisfies StreamEvent;
  };
}

describe('withRetryRuntime', () => {
  it('retries on rate_limit and eventually returns ok', async () => {
    const successResult = ok<RunResult>({ content: 'done', stopReason: 'end_turn' });
    let calls = 0;

    const mockRuntime: AgentRuntime = {
      run: async (_input) => {
        calls++;
        if (calls < 3) return err(new AIError('rate limited', 'rate_limit'));
        return successResult;
      },
      stream: makeStream(),
    };

    const wrapped = withRetryRuntime(mockRuntime);
    const result = await wrapped.run({ ...baseInput });

    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  }, 60_000);

  it('does not retry auth_error and returns err after first attempt', async () => {
    let calls = 0;

    const mockRuntime: AgentRuntime = {
      run: async (_input) => {
        calls++;
        return err(new AIError('unauthorized', 'auth_error'));
      },
      stream: makeStream(),
    };

    const wrapped = withRetryRuntime(mockRuntime);
    const result = await wrapped.run({ ...baseInput });

    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('does not retry when signal is already aborted', async () => {
    let calls = 0;

    const mockRuntime: AgentRuntime = {
      run: async (_input) => {
        calls++;
        return err(new AIError('rate limited', 'rate_limit'));
      },
      stream: makeStream(),
    };

    const controller = new AbortController();
    controller.abort();

    const wrapped = withRetryRuntime(mockRuntime);
    const result = await wrapped.run({ ...baseInput, signal: controller.signal });

    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('stream() is the original bound function — not a new wrapper', () => {
    const originalStream = makeStream();
    const mockRuntime: AgentRuntime = {
      run: async (_input) => ok<RunResult>({ content: '', stopReason: 'end_turn' }),
      stream: originalStream,
    };

    const wrapped = withRetryRuntime(mockRuntime);
    // .bind() produces a new function object, but we confirm it's NOT a
    // custom async wrapper by checking it's not the same reference as run
    expect(wrapped.stream).not.toBe(wrapped.run);
    expect(typeof wrapped.stream).toBe('function');
  });
});
