import { AIError, AbortError, classifyAIError } from '../errors';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  signal?: AbortSignal;
}

const RETRYABLE_CLASSIFICATIONS = new Set([
  'rate_limit',
  'overloaded',
  'network',
  'timeout',
  'model_unavailable',
]);

export function isRetryable(error: unknown): boolean {
  if (error instanceof AbortError) return false;

  if (error instanceof AIError) {
    return RETRYABLE_CLASSIFICATIONS.has(error.classification);
  }

  // Only classify plain objects and generic Error instances as potential HTTP errors.
  // Named error types (TypeError, RangeError, SyntaxError, etc.) are programming
  // mistakes — never retry them.
  if (error instanceof Error && error.constructor !== Error) {
    return false; // e.g. TypeError, RangeError, custom named errors
  }

  // Plain objects or generic Error instances may be raw SDK HTTP errors
  const classified = classifyAIError(error);
  return RETRYABLE_CLASSIFICATIONS.has(classified.classification);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new AbortError('Retry aborted', 'user'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 10;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const maxDelayMs = opts?.maxDelayMs ?? 32_000;
  const shouldRetry = opts?.shouldRetry ?? isRetryable;
  const signal = opts?.signal;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      let delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * baseDelayMs * 0.25,
        maxDelayMs,
      );

      if (error instanceof AIError && error.retryAfterMs != null) {
        delay = Math.max(delay, error.retryAfterMs);
      }

      await sleep(delay, signal);
    }
  }

  throw lastError;
}
