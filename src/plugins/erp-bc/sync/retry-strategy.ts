import { TransientError, ConflictError, RateLimitError, PermanentError, AuthError } from './sync-errors';
import type { BcError } from './sync-errors';

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

export const CONFLICT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
};

export function shouldRetry(error: BcError, attempt: number, policy: RetryPolicy): boolean {
  if (attempt >= policy.maxRetries) return false;
  if (error instanceof PermanentError) return false;
  if (error instanceof AuthError) return attempt < 1;
  if (error instanceof RateLimitError) return true;
  if (error instanceof TransientError) return true;
  if (error instanceof ConflictError) return attempt < CONFLICT_RETRY_POLICY.maxRetries;
  return false;
}

export function getDelayMs(error: BcError, attempt: number, policy: RetryPolicy): number {
  if (error instanceof RateLimitError) return error.retryAfterMs;
  const base = policy.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(base, policy.maxDelayMs);
  return capped + Math.random() * 200;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  onRetry?: (error: BcError, attempt: number, delayMs: number) => void,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (rawErr) {
      const error = rawErr as BcError;
      if (!shouldRetry(error, attempt, policy)) throw error;
      const delayMs = getDelayMs(error, attempt, policy);
      onRetry?.(error, attempt, delayMs);
      await new Promise(r => setTimeout(r, delayMs));
      attempt++;
    }
  }
}
