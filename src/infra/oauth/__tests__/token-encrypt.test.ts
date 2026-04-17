import { describe, it, expect } from 'bun:test';
import { encryptToken, decryptToken } from '../token-encrypt';

// Set required env var for tests
process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-master-key-32-bytes-padding!!';

describe('token-encrypt', () => {
  const workspaceId = 'ws-test-123';
  const plaintext = 'sk-ant-super-secret-token-xyz';

  it('round-trips a token correctly', () => {
    const { encrypted, iv, tag } = encryptToken(plaintext, workspaceId);
    const result = decryptToken(encrypted, iv, tag, workspaceId);
    expect(result).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext', () => {
    const a = encryptToken(plaintext, workspaceId);
    const b = encryptToken(plaintext, workspaceId);
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
  });

  it('throws on wrong workspace (key domain separation)', () => {
    const { encrypted, iv, tag } = encryptToken(plaintext, workspaceId);
    expect(() => decryptToken(encrypted, iv, tag, 'different-workspace')).toThrow();
  });
});
