import { describe, test, expect, mock, afterAll } from 'bun:test';

// Mock the embedding provider
const _realMemoryEmbedding = require('../memory.embedding');
mock.module('../memory.embedding', () => ({
  ..._realMemoryEmbedding,
  getEmbeddingProvider: () => ({
    embed: mock(() => Promise.resolve(new Array(1536).fill(0.1))),
    dimensions: 1536,
  }),
}));

// Mock vector store (no real pgvector in tests)
const _realMemoryStore = require('../memory.store');
mock.module('../memory.store', () => ({
  ..._realMemoryStore,
  PgVectorMemoryStore: class {
    async search() { return []; }
    async upsert() {}
    async delete() {}
  },
}));

import { hybridSearch } from '../memory.search';

// Stub repo injected directly — no mock.module needed
const stubRepo = {
  search: async () => [
    { id: 'mem-1', title: 'Supplier X', content: 'Lead time 14 days', type: 'domain', confidence: 1.0, source: 'explicit', metadata: {}, workspaceId: 'ws-1', createdAt: new Date(), updatedAt: new Date() },
  ],
} as any;

describe('hybridSearch', () => {
  test('returns text results when vector search returns nothing', async () => {
    const results = await hybridSearch('supplier', 'ws-1', undefined, 5, stubRepo);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('score');
    expect(typeof results[0].score).toBe('number');
  });

  test('respects limit parameter', async () => {
    const results = await hybridSearch('supplier', 'ws-1', undefined, 1, stubRepo);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test('returns scores between 0 and 1', async () => {
    const results = await hybridSearch('supplier', 'ws-1', undefined, 5, stubRepo);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});

afterAll(() => mock.restore());
