import { describe, it, expect } from 'bun:test';
import { envSchema } from '../env';

describe('env schema', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost/test',
    CLERK_SECRET_KEY: 'sk_test',
  };

  it('has defaults for AI routing vars', () => {
    const result = envSchema.parse(base);
    expect(result.AI_DEFAULT_PROVIDER).toBe('anthropic');
    expect(result.AI_FALLBACK_ENABLED).toBe(true);
    expect(result.INTENT_GATE_ENABLED).toBe(true);
  });

  it('has defaults for compaction vars', () => {
    const result = envSchema.parse(base);
    expect(result.COMPACTION_MAX_MESSAGES).toBe(100);
    expect(result.COMPACTION_TOKEN_BUDGET).toBe(150_000);
  });

  it('has defaults for SSE sequence and idempotency', () => {
    const result = envSchema.parse(base);
    expect(result.SSE_SEQUENCE_ENABLED).toBe(true);
    expect(result.AI_IDEMPOTENCY_ENABLED).toBe(true);
  });

  it('has default for memory auto-extraction', () => {
    const result = envSchema.parse(base);
    expect(result.MEMORY_AUTO_EXTRACT).toBe(false);
  });

  it('accepts model override vars', () => {
    const result = envSchema.parse({
      ...base,
      MODEL_OVERRIDE_FAST: 'claude-haiku-4-5-20251001',
      MODEL_OVERRIDE_BALANCED: 'claude-sonnet-4-6',
      MODEL_OVERRIDE_POWERFUL: 'claude-opus-4-6',
    });
    expect(result.MODEL_OVERRIDE_FAST).toBe('claude-haiku-4-5-20251001');
    expect(result.MODEL_OVERRIDE_BALANCED).toBe('claude-sonnet-4-6');
    expect(result.MODEL_OVERRIDE_POWERFUL).toBe('claude-opus-4-6');
  });
});
