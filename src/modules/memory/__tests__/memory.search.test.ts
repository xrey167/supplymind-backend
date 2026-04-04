import { describe, test, expect, mock } from 'bun:test';

// Mock the embedding provider
mock.module('../memory.embedding', () => ({
  getEmbeddingProvider: () => ({
    embed: mock(() => Promise.resolve(new Array(1536).fill(0.1))),
    dimensions: 1536,
  }),
}));

// Mock vector store (no real pgvector in tests)
mock.module('../memory.store', () => ({
  PgVectorMemoryStore: class {
    async search() { return []; }
    async upsert() {}
    async delete() {}
  },
}));

// Mock repo for text search
mock.module('../memory.repo', () => ({
  memoryRepo: {
    search: mock(() => Promise.resolve([
      { id: 'mem-1', title: 'Supplier X', content: 'Lead time 14 days', type: 'domain', confidence: 1.0, source: 'explicit', metadata: {}, workspaceId: 'ws-1', createdAt: new Date(), updatedAt: new Date() },
    ])),
    get: mock((id: string) => Promise.resolve(
      { id, title: 'Supplier X', content: 'Lead time 14 days', type: 'domain', confidence: 1.0, source: 'explicit', metadata: {}, workspaceId: 'ws-1', createdAt: new Date(), updatedAt: new Date() },
    )),
  },
}));

import { hybridSearch } from '../memory.search';

describe('hybridSearch', () => {
  test('returns text results when vector search returns nothing', async () => {
    const results = await hybridSearch('supplier', 'ws-1');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain('Supplier X');
  });

  test('respects limit parameter', async () => {
    const results = await hybridSearch('supplier', 'ws-1', undefined, 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test('returns scores between 0 and 1', async () => {
    const results = await hybridSearch('supplier', 'ws-1');
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
