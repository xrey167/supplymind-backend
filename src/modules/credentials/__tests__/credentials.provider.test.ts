import { describe, test, expect, beforeAll } from 'bun:test';
import { encrypt, decrypt } from '../credentials.provider';

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-master-key-for-unit-tests-32b';
});

describe('credentials.provider', () => {
  test('encrypt/decrypt roundtrip returns original plaintext', () => {
    const plaintext = 'sk-ant-api03-secret-key-here';
    const workspaceId = '00000000-0000-0000-0000-000000000001';

    const { encrypted, iv, tag } = encrypt(plaintext, workspaceId);
    const result = decrypt(encrypted, iv, tag, workspaceId);

    expect(result).toBe(plaintext);
  });

  test('different workspaces produce different ciphertexts', () => {
    const plaintext = 'same-secret-value';
    const ws1 = '00000000-0000-0000-0000-000000000001';
    const ws2 = '00000000-0000-0000-0000-000000000002';

    const enc1 = encrypt(plaintext, ws1);
    const enc2 = encrypt(plaintext, ws2);

    // Encrypted values should differ (different derived keys + random IVs)
    expect(enc1.encrypted).not.toBe(enc2.encrypted);

    // But each decrypts back to the same plaintext
    expect(decrypt(enc1.encrypted, enc1.iv, enc1.tag, ws1)).toBe(plaintext);
    expect(decrypt(enc2.encrypted, enc2.iv, enc2.tag, ws2)).toBe(plaintext);
  });

  test('decrypt with wrong workspace throws', () => {
    const plaintext = 'secret';
    const ws1 = '00000000-0000-0000-0000-000000000001';
    const ws2 = '00000000-0000-0000-0000-000000000002';

    const { encrypted, iv, tag } = encrypt(plaintext, ws1);

    expect(() => decrypt(encrypted, iv, tag, ws2)).toThrow();
  });

  test('throws when CREDENTIALS_ENCRYPTION_KEY is missing', () => {
    const saved = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    expect(() => encrypt('test', 'ws-id')).toThrow('CREDENTIALS_ENCRYPTION_KEY');

    process.env.CREDENTIALS_ENCRYPTION_KEY = saved;
  });

  test('encrypt produces base64 encoded outputs', () => {
    const { encrypted, iv, tag } = encrypt('hello', '00000000-0000-0000-0000-000000000001');

    // Base64 strings should not throw when decoded
    expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    expect(() => Buffer.from(iv, 'base64')).not.toThrow();
    expect(() => Buffer.from(tag, 'base64')).not.toThrow();

    // IV for AES-GCM is 12 bytes
    expect(Buffer.from(iv, 'base64').length).toBe(12);
    // Auth tag is 16 bytes
    expect(Buffer.from(tag, 'base64').length).toBe(16);
  });
});
