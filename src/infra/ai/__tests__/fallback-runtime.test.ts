import { describe, it, expect } from 'bun:test';
import { withFallbackRuntime } from '../runtime-factory';
import type { AgentRuntime, RunInput, RunResult, StreamEvent } from '../types';
import { ok, err } from '../../../core/result';
import type { Result } from '../../../core/result';

const input: RunInput = { messages: [{ role: 'user', content: 'hi' }], model: 'test-model' };

function makeRuntime(succeed: boolean): AgentRuntime {
  return {
    async run(): Promise<Result<RunResult>> {
      if (succeed) return ok({ content: 'response', toolCalls: [] });
      return err(new Error('provider_down'));
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'done' as const, data: {} };
    },
  };
}

describe('withFallbackRuntime', () => {
  it('returns primary result when primary succeeds', async () => {
    const runtime = withFallbackRuntime([makeRuntime(true), makeRuntime(false)]);
    const result = await runtime.run(input);
    expect(result.ok).toBe(true);
  });

  it('falls through to secondary when primary fails', async () => {
    const runtime = withFallbackRuntime([makeRuntime(false), makeRuntime(true)]);
    const result = await runtime.run(input);
    expect(result.ok).toBe(true);
  });

  it('returns last error when all providers fail', async () => {
    const runtime = withFallbackRuntime([makeRuntime(false), makeRuntime(false)]);
    const result = await runtime.run(input);
    expect(result.ok).toBe(false);
  });

  it('throws when given empty provider list', () => {
    expect(() => withFallbackRuntime([])).toThrow('at least one runtime');
  });
});
