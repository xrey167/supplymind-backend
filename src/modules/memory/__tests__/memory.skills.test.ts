import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../../infra/db/client', () => ({
  db: {
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => [{
          id: 'mem-1', workspaceId: 'ws-1', type: 'domain', title: 'Test',
          content: 'Test content', confidence: 1.0, source: 'explicit',
          metadata: {}, createdAt: new Date(), updatedAt: new Date(),
        }]),
      })),
    })),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [{
            id: 'mem-1', workspaceId: 'ws-1', type: 'domain', title: 'Supplier X',
            content: 'Lead time 14 days', confidence: 1.0, source: 'explicit',
            metadata: {}, createdAt: new Date(), updatedAt: new Date(),
          }]),
        })),
      })),
    })),
    delete: mock(() => ({ where: mock(() => ({ rowCount: 1 })) })),
  },
}));

mock.module('../../../infra/db/schema', () => ({
  agentMemories: { id: {}, workspaceId: {}, agentId: {}, title: {}, content: {} },
  memoryProposals: { id: {} },
}));

mock.module('drizzle-orm', () => ({
  eq: (...a: unknown[]) => a,
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
  isNull: (a: unknown) => a,
  ilike: (...a: unknown[]) => a,
}));

import { registerMemorySkills } from '../memory.skills';
import { skillRegistry } from '../../skills/skills.registry';

describe('memory skills', () => {
  beforeEach(() => {
    skillRegistry.clear();
    registerMemorySkills();
  });

  test('registers remember, recall, propose_memory, forget skills', () => {
    expect(skillRegistry.has('remember')).toBe(true);
    expect(skillRegistry.has('recall')).toBe(true);
    expect(skillRegistry.has('propose_memory')).toBe(true);
    expect(skillRegistry.has('forget')).toBe(true);
  });

  test('remember skill returns ok result', async () => {
    const result = await skillRegistry.invoke('remember', {
      title: 'Test', content: 'Test content', type: 'domain',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as any).memoryId).toBe('mem-1');
  });

  test('recall skill returns memories', async () => {
    const result = await skillRegistry.invoke('recall', { query: 'supplier' });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as any).length).toBeGreaterThan(0);
  });

  test('forget skill returns ok', async () => {
    const result = await skillRegistry.invoke('forget', { memoryId: 'mem-1' });
    expect(result.ok).toBe(true);
  });
});
