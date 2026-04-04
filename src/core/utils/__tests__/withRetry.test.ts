import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { withRetry, isRetryable, RetryOptions } from '../withRetry';
import { AIError, AbortError } from '../../errors';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRateLimitError(retryAfterMs?: number) {
  return new AIError('rate limit exceeded', 'rate_limit', retryAfterMs);
}

function makeAuthError() {
  return new AIError('invalid api key', 'auth_error');
}

// ─── isRetryable ────────────────────────────────────────────────────────────

describe('isRetryable', () => {
  it('returns false for AbortError', () => {
    expect(isRetryable(new AbortError('aborted', 'user'))).toBe(false);
  });

  it('returns true for rate_limit AIError', () => {
    expect(isRetryable(new AIError('rl', 'rate_limit'))).toBe(true);
  });

  it('returns true for overloaded AIError', () => {
    expect(isRetryable(new AIError('ol', 'overloaded'))).toBe(true);
  });

  it('returns false for auth_error AIError', () => {
    expect(isRetryable(new AIError('auth', 'auth_error'))).toBe(false);
  });

  it('returns false for prompt_too_long AIError', () => {
    expect(isRetryable(new AIError('long', 'prompt_too_long'))).toBe(false);
  });

  it('classifies raw errors via classifyAIError', () => {
    const rawError = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    expect(isRetryable(rawError)).toBe(true);
  });
});

// ─── withRetry ───────────────────────────────────────────────────────────────

describe('withRetry', () => {
  // Suppress real delays in all tests by replacing setTimeout with an
  // immediately-resolving mock by default.
  let originalSetTimeout: typeof setTimeout;

  beforeEach(() => {
    originalSetTimeout = globalThis.setTimeout;
    // Default: instant resolution (no real waiting)
    (globalThis as any).setTimeout = (fn: () => void, _delay?: number) => {
      fn();
      return 0 as any;
    };
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  // 1 ─ succeeds on first attempt
  it('succeeds on first attempt — returns value, fn called once', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  // 2 ─ retries on rate_limit, succeeds on 3rd attempt
  it('retries on rate_limit AIError and succeeds on 3rd attempt', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw makeRateLimitError();
      return 'ok';
    }, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  // 3 ─ does NOT retry auth_error
  it('does NOT retry auth_error AIError — throws after first failure', async () => {
    let calls = 0;
    const err = makeAuthError();
    await expect(
      withRetry(async () => {
        calls++;
        throw err;
      }),
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  // 4 ─ does NOT retry AbortError
  it('does NOT retry AbortError — throws immediately', async () => {
    let calls = 0;
    const err = new AbortError('aborted', 'user');
    await expect(
      withRetry(async () => {
        calls++;
        throw err;
      }),
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  // 5 ─ throws after maxAttempts exhausted
  it('throws after maxAttempts exhausted — fn called exactly maxAttempts times', async () => {
    const maxAttempts = 4;
    let calls = 0;
    const err = makeRateLimitError();
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err;
        },
        { maxAttempts, baseDelayMs: 1 },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(maxAttempts);
  });

  // 6 ─ respects retryAfterMs
  it('respects retryAfterMs — delay is at least retryAfterMs', async () => {
    const delays: number[] = [];

    // Override setTimeout to capture the delay value
    (globalThis as any).setTimeout = (fn: () => void, delay?: number) => {
      delays.push(delay ?? 0);
      fn();
      return 0 as any;
    };

    const retryAfterMs = 5000;
    let calls = 0;

    await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw makeRateLimitError(retryAfterMs);
        return 'done';
      },
      { baseDelayMs: 1, maxDelayMs: 100 }, // computed delay would be tiny
    );

    expect(calls).toBe(2);
    expect(delays.length).toBeGreaterThanOrEqual(1);
    expect(delays[0]).toBeGreaterThanOrEqual(retryAfterMs);
  });

  // 7 ─ custom shouldRetry returning false
  it('custom shouldRetry returning false — throws immediately', async () => {
    let calls = 0;
    const err = makeRateLimitError();
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err;
        },
        { shouldRetry: () => false },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  // 8 ─ custom shouldRetry returning true retries even auth_error
  it('custom shouldRetry returning true — retries even for auth_error', async () => {
    let calls = 0;
    const err = makeAuthError();
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err;
        },
        { maxAttempts: 3, baseDelayMs: 1, shouldRetry: () => true },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(3);
  });

  // 9 ─ raw SDK error (plain Error with status 429) is retried end-to-end
  it('retries raw SDK rate-limit error (plain Error + status 429) and eventually succeeds', async () => {
    let calls = 0;
    const rawSdkError = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw rawSdkError;
        return 'recovered';
      },
      { baseDelayMs: 1 },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });
});
