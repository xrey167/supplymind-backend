import { describe, test, expect } from 'bun:test';
import { hashApiKey } from '../api-key';

describe('hashApiKey', () => {
  test('returns 64-char hex string', async () => {
    const hash = await hashApiKey('a2a_k_abc123');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('is deterministic', async () => {
    const a = await hashApiKey('a2a_k_test_token');
    const b = await hashApiKey('a2a_k_test_token');
    expect(a).toBe(b);
  });

  test('different inputs produce different hashes', async () => {
    const a = await hashApiKey('a2a_k_token_one');
    const b = await hashApiKey('a2a_k_token_two');
    expect(a).not.toBe(b);
  });

  test('empty string produces valid hash', async () => {
    const hash = await hashApiKey('');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('long input produces valid hash', async () => {
    const hash = await hashApiKey('a'.repeat(10000));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
