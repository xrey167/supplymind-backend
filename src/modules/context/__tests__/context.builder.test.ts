import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../infra/ai/runtime-factory', () => ({
  createRuntime: () => ({
    run: mock(() => Promise.resolve({ ok: true, value: { content: 'Summary of conversation' } })),
  }),
}));

import { buildContext } from '../context.builder';

// Minimal mock for the memoryService.recall dependency
const mockRecallMemory = {
  id: 'mem-1',
  type: 'domain' as const,
  title: 'Supplier X',
  content: 'Lead time 14 days',
  confidence: 1.0,
  source: 'explicit' as const,
  metadata: {},
  workspaceId: 'ws-1',
  agentId: undefined as unknown as string,
  scope: 'workspace' as const,
  stale: false,
  staleDays: 0,
  createdAt: new Date(),
  updatedAt: new Date().toISOString(),
};

const mockMemoryService = {
  recall: mock(async () => [mockRecallMemory]),
};

const emptyMemoryService = {
  recall: mock(async () => []),
};

describe('buildContext', () => {
  test('includes agent system prompt', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'hello' }],
      { model: 'claude-sonnet-4-20250514', systemPrompt: 'You are helpful.', workspaceId: 'ws-1' },
      undefined,
      emptyMemoryService,
    );
    expect(result.systemPrompt).toContain('You are helpful.');
  });

  test('includes workspace context', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'hello' }],
      { model: 'claude-sonnet-4-20250514', workspaceId: 'ws-1' },
      { name: 'Acme Corp', description: 'Supply chain management' },
      emptyMemoryService,
    );
    expect(result.systemPrompt).toContain('Acme Corp');
  });

  test('includes recalled memories in system prompt', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'tell me about supplier X' }],
      { model: 'claude-sonnet-4-20250514', workspaceId: 'ws-1' },
      undefined,
      mockMemoryService,
    );
    expect(result.systemPrompt).toContain('Supplier X');
    expect(result.systemPrompt).toContain('Lead time 14 days');
  });

  test('returns messages and token estimate', async () => {
    const result = await buildContext(
      [{ role: 'user', content: 'hello' }],
      { model: 'claude-sonnet-4-20250514', workspaceId: 'ws-1' },
      undefined,
      emptyMemoryService,
    );
    expect(result.messages.length).toBe(1);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});
