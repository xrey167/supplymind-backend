export class TransientError extends Error {
  readonly kind = 'TransientError' as const;
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'TransientError';
  }
}

export class AuthError extends Error {
  readonly kind = 'AuthError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** 409 — handled internally by BcClient.patch() via ETag merge-retry (max 3 attempts). Not retried by withRetry(). */
export class ConflictError extends Error {
  readonly kind = 'ConflictError' as const;
  constructor(message: string, public readonly entityId?: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class PermanentError extends Error {
  readonly kind = 'PermanentError' as const;
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class RateLimitError extends Error {
  readonly kind = 'RateLimitError' as const;
  constructor(message: string, public readonly retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export type BcError = TransientError | AuthError | ConflictError | PermanentError | RateLimitError;

export function classifyHttpError(statusCode: number, body: string, retryAfterHeader?: string | null): BcError {
  if (statusCode === 401) return new AuthError(`BC API returned 401: ${body}`);
  if (statusCode === 409) return new ConflictError(`BC API conflict: ${body}`);
  if (statusCode === 429) {
    const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
    return new RateLimitError(`BC API rate limited`, (isNaN(retryAfterSec) ? 60 : retryAfterSec) * 1000);
  }
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return new PermanentError(`BC API permanent error ${statusCode}: ${body}`, statusCode);
  }
  if (statusCode >= 500) return new TransientError(`BC API server error ${statusCode}: ${body}`, statusCode);
  return new PermanentError(`BC API unexpected error ${statusCode}: ${body}`, statusCode);
}
