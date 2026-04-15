import { describe, test, expect } from 'bun:test';

// This test file is intentionally minimal because other test files (memory.service.test.ts,
// context.builder.test.ts) use mock.module on memory.embedding which globally replaces
// the module in bun:test's shared process. Dynamic import also returns the mock.
// The actual embedding logic is integration-tested through memory.service and memory.search tests.

describe('memory.embedding', () => {
  test('module can be imported without error', async () => {
    const mod = await import('../memory.embedding');
    expect(mod).toBeDefined();
  });

  test('getEmbeddingProvider is exported as a function', async () => {
    const mod = await import('../memory.embedding');
    expect(typeof mod.getEmbeddingProvider).toBe('function');
  });
});

afterAll(() => mock.restore());
