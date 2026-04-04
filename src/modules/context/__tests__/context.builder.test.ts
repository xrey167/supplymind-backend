import { describe, test, expect, mock } from 'bun:test';

// Mock memory dependencies at the repo/embedding/search level instead of the service level
// to avoid polluting the global memoryService mock for other test files
mock.module('../../memory/memory.repo', () => ({
  memoryRepo: {
    save: mock(() => Promise.resolve({ id: 'mem-1' })),
    search: mock(() => Promise.resolve([
      { id: 'mem-1', type: 'domain', title: 'Supplier X', content: 'Lead time 14 days', confidence: 1.0, source: 'explicit', metadata: {}, workspaceId: 'ws-1', createdAt: new Date(), updatedAt: new Date() },
    ])),
    list: mock(() => Promise.resolve([])),
    delete: mock(() => Promise.resolve(true)),
    get: mock(() => Promise.resolve({ id: 'mem-1', type: 'domain', title: 'Supplier X', content: 'Lead time 14 days', confidence: 1.0, source: 'explicit', metadata: {}, workspaceId: 'ws-1', createdAt: new Date(), updatedAt: new Date() })),
    createProposal: mock(() => Promise.resolve({ id: 'prop-1' })),
    getProposal: mock(() => Promise.resolve(null)),
    approveProposal: mock(() => Promise.resolve({ id: 'mem-1' })),
    rejectProposal: mock(() => Promise.resolve()),
  },
}));

mock.module('../../memory/memory.embedding', () => ({
  getEmbeddingProvider: () => ({ embed: mock(async () => [0.1, 0.2]) }),
}));

mock.module('../../memory/memory.store', () => ({
  PgVectorMemoryStore: class { upsert = mock(async () => undefined); },
}));

mock.module('../../../infra/ai/runtime-factory', () => ({
  createRuntime: () => ({
    run: mock(() => Promise.resolve({ ok: true, value: { content: 'Summary of conversation' } })),
  }),
}));

import { buildContext } from '../context.builder';

describe('buildContext', () => {
  test('includes agent system prompt', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'hello' }],
      { model: 'claude-sonnet-4-20250514', systemPrompt: 'You are helpful.', workspaceId: 'ws-1' },
    );
    expect(result.systemPrompt).toContain('You are helpful.');
  });

  test('includes workspace context', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'hello' }],
      { model: 'claude-sonnet-4-20250514', workspaceId: 'ws-1' },
      { name: 'Acme Corp', description: 'Supply chain management' },
    );
    expect(result.systemPrompt).toContain('Acme Corp');
  });

  test('includes recalled memories in system prompt', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'tell me about supplier X' }],
      { model: 'claude-sonnet-4-20250514', workspaceId: 'ws-1' },
    );
    expect(result.systemPrompt).toContain('Supplier X');
    expect(result.systemPrompt).toContain('Lead time 14 days');
  });

  test('returns messages and token estimate', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'hello' }],
      { model: 'claude-sonnet-4-20250514', workspaceId: 'ws-1' },
    );
    expect(result.messages.length).toBe(1);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});
