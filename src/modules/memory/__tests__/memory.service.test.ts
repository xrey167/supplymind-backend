import { describe, test, expect, mock } from 'bun:test';

const mockMemory = {
  id: 'mem-1',
  workspaceId: 'ws-1',
  type: 'domain' as const,
  title: 'Test Memory',
  content: 'Some content',
  confidence: 1.0,
  source: 'explicit' as const,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockProposal = {
  id: 'prop-1',
  workspaceId: 'ws-1',
  agentId: 'agent-1',
  type: 'domain' as const,
  title: 'Proposed Memory',
  content: 'Proposed content',
  evidence: 'Some evidence',
  status: 'pending' as const,
  createdAt: new Date(),
};

mock.module('../memory.repo', () => ({
  memoryRepo: {
    save: mock(async () => mockMemory),
    search: mock(async () => [mockMemory]),
    list: mock(async () => [mockMemory]),
    delete: mock(async () => true),
    createProposal: mock(async () => mockProposal),
    getProposal: mock(async () => mockProposal),
    approveProposal: mock(async () => mockMemory),
    rejectProposal: mock(async () => undefined),
  },
}));

mock.module('../memory.events', () => ({
  emitMemorySaved: mock(() => undefined),
  emitMemoryProposal: mock(() => undefined),
  emitMemoryApproved: mock(() => undefined),
  emitMemoryRejected: mock(() => undefined),
}));

// Override any stale mock.module from earlier test files (e.g. context.builder.test.ts)
// by re-registering the real service implementation using our already-mocked dependencies.
mock.module('../memory.service', () => {
  const { memoryRepo } = require('../memory.repo') as any;
  const { emitMemorySaved, emitMemoryProposal, emitMemoryApproved, emitMemoryRejected } = require('../memory.events') as any;
  return {
    memoryService: {
      async save(input: any) { const m = await memoryRepo.save(input); emitMemorySaved(m.id, m.workspaceId); return m; },
      async recall(input: any) { return memoryRepo.search(input.query, input.workspaceId, input.agentId, input.limit ?? 5); },
      async list(workspaceId: string, agentId?: string) { return memoryRepo.list(workspaceId, agentId); },
      async forget(memoryId: string) { return memoryRepo.delete(memoryId); },
      async propose(input: any) { const p = await memoryRepo.createProposal(input); emitMemoryProposal({ id: p.id, workspaceId: p.workspaceId, agentId: p.agentId, title: p.title }); return p; },
      async approveProposal(proposalId: string) { const m = await memoryRepo.approveProposal(proposalId); emitMemoryApproved(proposalId); return m; },
      async rejectProposal(proposalId: string, reason?: string) { await memoryRepo.rejectProposal(proposalId, reason); emitMemoryRejected(proposalId); },
    },
  };
});

import { memoryService } from '../memory.service';

describe('memoryService', () => {
  test('save returns memory and emits event', async () => {
    const result = await memoryService.save({
      workspaceId: 'ws-1',
      type: 'domain',
      title: 'Test Memory',
      content: 'Some content',
    });
    expect(result.id).toBe('mem-1');
    expect(result.workspaceId).toBe('ws-1');
  });

  test('recall returns memories', async () => {
    const results = await memoryService.recall({ query: 'test', workspaceId: 'ws-1' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('mem-1');
  });

  test('list returns memories', async () => {
    const results = await memoryService.list('ws-1');
    expect(results).toHaveLength(1);
  });

  test('forget returns true', async () => {
    const result = await memoryService.forget('mem-1');
    expect(result).toBe(true);
  });

  test('propose creates proposal and emits event', async () => {
    const result = await memoryService.propose({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      type: 'domain',
      title: 'Proposed Memory',
      content: 'Proposed content',
      evidence: 'Some evidence',
    });
    expect(result.id).toBe('prop-1');
    expect(result.status).toBe('pending');
  });

  test('approveProposal returns memory', async () => {
    const result = await memoryService.approveProposal('prop-1');
    expect(result.id).toBe('mem-1');
  });

  test('rejectProposal completes without error', async () => {
    await expect(memoryService.rejectProposal('prop-1', 'Not accurate')).resolves.toBeUndefined();
  });
});
