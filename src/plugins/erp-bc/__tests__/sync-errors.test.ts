import { describe, it, expect } from 'bun:test';
import { classifyHttpError, TransientError, AuthError, ConflictError, PermanentError, RateLimitError } from '../sync/sync-errors';

describe('classifyHttpError', () => {
  it('401 → AuthError', () => expect(classifyHttpError(401, '')).toBeInstanceOf(AuthError));
  it('409 → ConflictError', () => expect(classifyHttpError(409, '')).toBeInstanceOf(ConflictError));
  it('429 → RateLimitError with retryAfterMs', () => {
    const e = classifyHttpError(429, '', '30');
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterMs).toBe(30_000);
  });
  it('400 → PermanentError', () => expect(classifyHttpError(400, '')).toBeInstanceOf(PermanentError));
  it('500 → TransientError', () => expect(classifyHttpError(500, '')).toBeInstanceOf(TransientError));
});
