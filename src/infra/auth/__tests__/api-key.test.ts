import { describe, test, expect } from 'bun:test';
import { hashApiKey } from '../api-key';

describe('API key utilities', () => {
  describe('hashApiKey', () => {
    test('should return a hex string', async () => {
      const hash = await hashApiKey('a2a_k_test123');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('should return consistent hash for same input', async () => {
      const hash1 = await hashApiKey('a2a_k_mykey');
      const hash2 = await hashApiKey('a2a_k_mykey');
      expect(hash1).toBe(hash2);
    });

    test('should return different hash for different input', async () => {
      const hash1 = await hashApiKey('a2a_k_key1');
      const hash2 = await hashApiKey('a2a_k_key2');
      expect(hash1).not.toBe(hash2);
    });
  });
});
