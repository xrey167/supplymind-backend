import { describe, it, expect } from 'bun:test';
import { generateIdempotencyKey } from '../idempotency';
import type { RunInput } from '../types';

const baseInput: RunInput = {
  messages: [{ role: 'user', content: 'hello' }],
  model: 'claude-sonnet-4-6',
};

describe('generateIdempotencyKey', () => {
  it('returns a deterministic key for the same input', () => {
    const k1 = generateIdempotencyKey(baseInput);
    const k2 = generateIdempotencyKey(baseInput);
    expect(k1).toBe(k2);
  });

  it('returns different keys for different messages', () => {
    const input2: RunInput = {
      messages: [{ role: 'user', content: 'goodbye' }],
      model: 'claude-sonnet-4-6',
    };
    expect(generateIdempotencyKey(baseInput)).not.toBe(generateIdempotencyKey(input2));
  });

  it('returns different keys for different models', () => {
    const input2: RunInput = { ...baseInput, model: 'claude-opus-4-6' };
    expect(generateIdempotencyKey(baseInput)).not.toBe(generateIdempotencyKey(input2));
  });

  it('returns a non-empty string', () => {
    const key = generateIdempotencyKey(baseInput);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('includes optional jobId when provided', () => {
    const k1 = generateIdempotencyKey(baseInput, { jobId: 'job_001' });
    const k2 = generateIdempotencyKey(baseInput, { jobId: 'job_002' });
    const kBase = generateIdempotencyKey(baseInput);
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(kBase);
  });

  it('key is URL-safe (no special chars)', () => {
    const key = generateIdempotencyKey(baseInput);
    expect(/^[a-f0-9]+$/.test(key)).toBe(true);
  });
});
