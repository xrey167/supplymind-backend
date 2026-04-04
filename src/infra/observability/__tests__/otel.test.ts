import { describe, it, expect } from 'bun:test';
import { withSpan } from '../otel';

// Without a registered OTel SDK, @opentelemetry/api returns no-op spans.
// withSpan still works correctly — it just wraps the function call.

describe('withSpan', () => {
  it('returns the result of fn on success', async () => {
    const result = await withSpan('test.op', { key: 'val' }, async () => 42);
    expect(result).toBe(42);
  });

  it('passes a span object to the callback', async () => {
    let capturedSpan: unknown;
    await withSpan('test.op', {}, async (span) => {
      capturedSpan = span;
      return null;
    });
    expect(capturedSpan).toBeDefined();
    expect(typeof (capturedSpan as any).setAttribute).toBe('function');
    expect(typeof (capturedSpan as any).setStatus).toBe('function');
    expect(typeof (capturedSpan as any).end).toBe('function');
  });

  it('re-throws errors from fn', async () => {
    await expect(
      withSpan('test.op', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('span.setAttribute can be called inside fn without error', async () => {
    const result = await withSpan('test.op', {}, async (span) => {
      span.setAttribute('custom.key', 'custom.value');
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  it('handles non-Error throws', async () => {
    await expect(
      withSpan('test.op', {}, async () => {
        throw 'string error';
      }),
    ).rejects.toThrow('string error');
  });

  it('preserves async context through the span', async () => {
    const result = await withSpan('outer', {}, async () => {
      const inner = await withSpan('inner', {}, async () => 'nested');
      return `result: ${inner}`;
    });
    expect(result).toBe('result: nested');
  });
});
