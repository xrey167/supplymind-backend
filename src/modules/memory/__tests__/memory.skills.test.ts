import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';

// Mock dynamic imports used by memory.service (safe — these are await import() calls)
mock.module('../memory.embedding', () => ({
  getEmbeddingProvider: () => ({ embed: mock(async () => [0.1, 0.2, 0.3]) }),
}));

mock.module('../memory.store', () => ({
  PgVectorMemoryStore: class { upsert = mock(async () => undefined); },
}));

mock.module('../memory.search', () => ({
  hybridSearch: mock(async () => [{ id: 'mem-1', score: 0.9 }]),
}));

import { registerMemorySkills } from '../memory.skills';
import { skillRegistry } from '../../skills/skills.registry';
import { memoryRepo } from '../memory.repo';
import { eventBus } from '../../../events/bus';

describe('memory skills', () => {
  beforeEach(() => {
    skillRegistry.clear();
    registerMemorySkills();

    // Spy on repo and eventBus so skills work without hitting real DB
    spyOn(memoryRepo, 'save').mockResolvedValue({
      id: 'mem-1', workspaceId: 'default', agentId: undefined,
      type: 'domain', title: 'Test', content: 'Test content',
      confidence: 1.0, source: 'explicit', metadata: {},
      createdAt: new Date(), updatedAt: new Date(),
    } as any);
    spyOn(memoryRepo, 'get').mockResolvedValue({
      id: 'mem-1', workspaceId: 'default', type: 'domain', title: 'Supplier X',
      content: 'Lead time 14 days', confidence: 1.0, source: 'explicit',
      metadata: {}, createdAt: new Date(), updatedAt: new Date(),
    } as any);
    spyOn(memoryRepo, 'search').mockResolvedValue([{
      id: 'mem-1', workspaceId: 'default', type: 'domain', title: 'Supplier X',
      content: 'Lead time 14 days', confidence: 1.0, source: 'explicit',
      metadata: {}, createdAt: new Date(), updatedAt: new Date(),
    }] as any);
    spyOn(memoryRepo, 'delete').mockResolvedValue(true);
    spyOn(eventBus, 'publish').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    mock.restore();
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
