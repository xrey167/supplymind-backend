import { describe, test, expect } from 'bun:test';

// PgVectorMemoryStore requires a real DB connection for meaningful tests.
// These tests verify the module exports and basic shape only.
// Full integration tests should run against a test database.

describe('PgVectorMemoryStore', () => {
  test('module exports PgVectorMemoryStore class', async () => {
    // Dynamic import to avoid triggering DB connection at module level
    const mod = await import('../memory.store');
    expect(typeof mod.PgVectorMemoryStore).toBe('function');
  });
});
