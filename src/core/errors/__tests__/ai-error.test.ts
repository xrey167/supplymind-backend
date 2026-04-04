import { describe, test, expect } from 'bun:test';
import { AIError, AbortError, ToolExecutionError, classifyAIError, AppError } from '../index';

describe('classifyAIError', () => {
  test('status 429 → rate_limit', () => {
    const err = classifyAIError({ status: 429 });
    expect(err.classification).toBe('rate_limit');
  });

  test('status 401 → auth_error', () => {
    const err = classifyAIError({ status: 401 });
    expect(err.classification).toBe('auth_error');
  });

  test('status 529 → overloaded', () => {
    const err = classifyAIError({ status: 529 });
    expect(err.classification).toBe('overloaded');
  });

  test('status 400 with context length → prompt_too_long', () => {
    const err = classifyAIError({ status: 400, message: 'context length exceeded' });
    expect(err.classification).toBe('prompt_too_long');
  });

  test('status 404 with model not found → model_unavailable', () => {
    const err = classifyAIError({ status: 404, message: 'model not found' });
    expect(err.classification).toBe('model_unavailable');
  });

  test('status 408 → timeout', () => {
    const err = classifyAIError({ status: 408 });
    expect(err.classification).toBe('timeout');
  });

  test('status 500 → network', () => {
    const err = classifyAIError({ status: 500 });
    expect(err.classification).toBe('network');
  });

  test('existing AIError is returned unchanged (idempotent)', () => {
    const original = new AIError('test', 'rate_limit');
    const result = classifyAIError(original);
    expect(result).toBe(original);
  });

  test('retryAfterMs parsed from retry-after header', () => {
    const err = classifyAIError({ status: 429, headers: { 'retry-after': '30' } });
    expect(err.retryAfterMs).toBe(30000);
  });

  test('classifyAIError(null) → network, does not throw', () => {
    const err = classifyAIError(null);
    expect(err.classification).toBe('network');
  });

  test('classifyAIError(undefined) → network, does not throw', () => {
    const err = classifyAIError(undefined);
    expect(err.classification).toBe('network');
  });

  test('Error with rate limit message → rate_limit', () => {
    const err = classifyAIError(new Error('rate limit exceeded'));
    expect(err.classification).toBe('rate_limit');
  });

  test('status 429 without retry-after header → retryAfterMs is undefined', () => {
    const err = classifyAIError({ status: 429 });
    expect(err.retryAfterMs).toBeUndefined();
  });
});

describe('AbortError', () => {
  test('has name === "AbortError"', () => {
    const err = new AbortError('aborted', 'user');
    expect(err.name).toBe('AbortError');
  });

  test('is NOT instanceof AppError', () => {
    const err = new AbortError('aborted', 'system');
    expect(err instanceof AppError).toBe(false);
  });

  test('is instanceof Error', () => {
    const err = new AbortError('aborted', 'timeout');
    expect(err instanceof Error).toBe(true);
  });
});

describe('ToolExecutionError', () => {
  test('carries toolName and riskLevel', () => {
    const err = new ToolExecutionError('failed', 'my-tool', 'HIGH');
    expect(err.toolName).toBe('my-tool');
    expect(err.riskLevel).toBe('HIGH');
  });

  test('default riskLevel is LOW', () => {
    const err = new ToolExecutionError('failed', 'my-tool');
    expect(err.riskLevel).toBe('LOW');
  });
});
