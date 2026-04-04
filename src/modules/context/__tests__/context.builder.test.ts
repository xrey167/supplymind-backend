import { describe, test, expect, mock } from 'bun:test';

mock.module('../../memory/memory.service', () => ({
  memoryService: {
    recall: mock(() => Promise.resolve([
      { type: 'domain', title: 'Supplier X', content: 'Lead time 14 days', confidence: 1.0 },
    ])),
  },
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
