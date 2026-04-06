import { describe, test, expect, beforeEach } from 'bun:test';
import { getClerkClient, verifyClerkToken, _resetClerkClient } from '../clerk';

describe('clerk', () => {
  beforeEach(() => {
    _resetClerkClient();
  });

  test('getClerkClient returns null when CLERK_SECRET_KEY is not set', () => {
    delete (Bun.env as any).CLERK_SECRET_KEY;
    const client = getClerkClient();
    expect(client).toBeNull();
  });

  test('getClerkClient caches result on subsequent calls', () => {
    delete (Bun.env as any).CLERK_SECRET_KEY;
    const first = getClerkClient();
    const second = getClerkClient();
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  test('verifyClerkToken throws when Clerk client is unavailable', async () => {
    delete (Bun.env as any).CLERK_SECRET_KEY;
    await expect(verifyClerkToken('fake.token.here')).rejects.toThrow('Clerk client not available');
  });
});
