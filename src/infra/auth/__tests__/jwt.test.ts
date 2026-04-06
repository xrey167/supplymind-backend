import { describe, test, expect } from 'bun:test';
import { decodeJwtPayload, isExpired } from '../jwt';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('decodeJwtPayload', () => {
  test('decodes a valid JWT payload', () => {
    const token = makeJwt({ sub: 'user_123', role: 'admin' });
    const payload = decodeJwtPayload(token);
    expect(payload.sub).toBe('user_123');
    expect(payload.role).toBe('admin');
  });

  test('throws on invalid format', () => {
    expect(() => decodeJwtPayload('not-a-jwt')).toThrow('Invalid JWT format');
    expect(() => decodeJwtPayload('a.b')).toThrow('Invalid JWT format');
  });
});

describe('isExpired', () => {
  test('returns false when no exp claim', () => {
    expect(isExpired({})).toBe(false);
  });

  test('returns false for future exp', () => {
    expect(isExpired({ exp: Date.now() / 1000 + 3600 })).toBe(false);
  });

  test('returns true for past exp', () => {
    expect(isExpired({ exp: Date.now() / 1000 - 3600 })).toBe(true);
  });
});
