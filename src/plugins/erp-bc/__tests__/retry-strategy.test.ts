import { describe, it, expect } from 'bun:test';
import { shouldRetry, withRetry, DEFAULT_RETRY_POLICY } from '../sync/retry-strategy';
import { TransientError, PermanentError, AuthError, ConflictError } from '../sync/sync-errors';

describe('shouldRetry', () => {
  it('does not retry PermanentError', () => {
    expect(shouldRetry(new PermanentError('bad'), 0, DEFAULT_RETRY_POLICY)).toBe(false);
  });
  it('retries TransientError up to maxRetries', () => {
    expect(shouldRetry(new TransientError('net'), 0, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(shouldRetry(new TransientError('net'), 5, DEFAULT_RETRY_POLICY)).toBe(false);
  });
  it('retries AuthError only once', () => {
    expect(shouldRetry(new AuthError('401'), 0, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(shouldRetry(new AuthError('401'), 1, DEFAULT_RETRY_POLICY)).toBe(false);
  });
  it('does not retry ConflictError (handled by BcClient.patch() internally)', () => {
    expect(shouldRetry(new ConflictError('409'), 0, DEFAULT_RETRY_POLICY)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns value on first success', async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  it('retries on TransientError and succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new TransientError('net');
        return 'ok';
      },
      { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 10 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws PermanentError immediately without retry', async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new PermanentError('schema error');
      }, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 10 });
    } catch (e) {
      expect(e).toBeInstanceOf(PermanentError);
      expect(calls).toBe(1);
    }
  });
});
