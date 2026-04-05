import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { AgentMemory, MemoryProposal } from '../memory.types';

// --- Fixtures ---

const mockMemory: AgentMemory = {
  id: 'mem-1',
  workspaceId: 'ws-1',
  agentId: 'agent-1',
  type: 'domain',
  title: 'Test Memory',
  content: 'Some content',
  confidence: 1.0,
  source: 'explicit',
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockProposal: MemoryProposal = {
  id: 'prop-1',
  workspaceId: 'ws-1',
  agentId: 'agent-1',
  type: 'domain',
  title: 'Proposed Memory',
  content: 'Proposed content',
  evidence: 'Some evidence',
  status: 'pending',
  createdAt: new Date('2024-01-01'),
};

// --- Mocks (must be declared before importing the module under test) ---

const repoMocks = {
  save: mock(async () => mockMemory),
  search: mock(async () => [mockMemory]),
  list: mock(async () => [mockMemory]),
  delete: mock(async () => true),
  get: mock(async (_id: string) => mockMemory),
  createProposal: mock(async () => mockProposal),
  getProposal: mock(async () => mockProposal),
  approveProposal: mock(async () => mockMemory),
  rejectProposal: mock(async () => undefined),
};

const eventMocks = {
  emitMemorySaved: mock(() => undefined),
  emitMemoryProposal: mock(() => undefined),
  emitMemoryApproved: mock(() => undefined),
  emitMemoryRejected: mock(() => undefined),
};

mock.module('../memory.repo', () => ({ memoryRepo: repoMocks }));
mock.module('../memory.events', () => eventMocks);

// Embedding path mocks — happy path by default
const embedMock = mock(async () => [0.1, 0.2, 0.3]);
const upsertMock = mock(async () => undefined);

mock.module('../memory.embedding', () => ({
  getEmbeddingProvider: () => ({ embed: embedMock }),
}));

mock.module('../memory.store', () => ({
  PgVectorMemoryStore: class {
    upsert = upsertMock;
  },
}));

// Hybrid search mock — happy path returns a hit by default
const hybridSearchMock = mock(async () => [{ id: 'mem-1', score: 0.9 }]);

mock.module('../memory.search', () => ({
  hybridSearch: hybridSearchMock,
}));

// Import after all mock.module calls
import { memoryService } from '../memory.service';

// --- Helpers ---

function resetMocks() {
  Object.values(repoMocks).forEach(m => m.mockClear());
  Object.values(eventMocks).forEach(m => m.mockClear());
  embedMock.mockClear();
  upsertMock.mockClear();
  hybridSearchMock.mockClear();
}

// --- Tests ---

describe('memoryService', () => {
  describe('save()', () => {
    beforeEach(() => {
      resetMocks();
      repoMocks.save.mockImplementation(async () => mockMemory);
      embedMock.mockImplementation(async () => [0.1, 0.2, 0.3]);
      upsertMock.mockImplementation(async () => undefined);
    });

    test('should save via repo and return the memory', async () => {
      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      const result = await memoryService.save(input);

      expect(repoMocks.save).toHaveBeenCalledTimes(1);
      expect(repoMocks.save).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockMemory);
    });

    test('should emit MemorySaved event with correct ids', async () => {
      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      await memoryService.save(input);

      expect(eventMocks.emitMemorySaved).toHaveBeenCalledTimes(1);
      expect(eventMocks.emitMemorySaved).toHaveBeenCalledWith(mockMemory.id, mockMemory.workspaceId);
    });

    test('should attempt to generate and upsert embedding', async () => {
      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      await memoryService.save(input);

      expect(embedMock).toHaveBeenCalledTimes(1);
      expect(upsertMock).toHaveBeenCalledTimes(1);
      expect(upsertMock).toHaveBeenCalledWith(mockMemory.id, mockMemory.content, [0.1, 0.2, 0.3], mockMemory.metadata);
    });

    test('should still save and emit event even when embedding fails', async () => {
      embedMock.mockImplementation(async () => { throw new Error('embed service unavailable'); });

      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      const result = await memoryService.save(input);

      expect(result).toEqual(mockMemory);
      expect(eventMocks.emitMemorySaved).toHaveBeenCalledTimes(1);
    });

    test('should still save and emit event when vector store upsert fails', async () => {
      upsertMock.mockImplementation(async () => { throw new Error('pgvector unavailable'); });

      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      const result = await memoryService.save(input);

      expect(result).toEqual(mockMemory);
      expect(eventMocks.emitMemorySaved).toHaveBeenCalledTimes(1);
    });

    test('should include agentId when provided', async () => {
      const input = { workspaceId: 'ws-1', agentId: 'agent-42', type: 'feedback' as const, title: 'Feedback', content: 'Good run' };
      await memoryService.save(input);

      expect(repoMocks.save).toHaveBeenCalledWith(input);
    });
  });

  describe('recall()', () => {
    beforeEach(() => {
      resetMocks();
      hybridSearchMock.mockImplementation(async () => [{ id: 'mem-1', score: 0.9 }]);
      repoMocks.get.mockImplementation(async () => mockMemory);
      repoMocks.search.mockImplementation(async () => [mockMemory]);
    });

    test('should return memories via hybrid search when it succeeds and returns results', async () => {
      const results = await memoryService.recall({ query: 'supply chain', workspaceId: 'ws-1' });

      expect(hybridSearchMock).toHaveBeenCalledTimes(1);
      expect(hybridSearchMock).toHaveBeenCalledWith('supply chain', 'ws-1', undefined, 5);
      expect(results).toHaveLength(1);
      // recall wraps results with toRecallResult — check core identity fields
      expect(results[0].id).toBe(mockMemory.id);
      expect(results[0].content).toBe(mockMemory.content);
    });

    test('should fall back to text search when hybrid search throws', async () => {
      hybridSearchMock.mockImplementation(async () => { throw new Error('pgvector down'); });

      const results = await memoryService.recall({ query: 'supply chain', workspaceId: 'ws-1' });

      expect(repoMocks.search).toHaveBeenCalledTimes(1);
      expect(repoMocks.search).toHaveBeenCalledWith('supply chain', 'ws-1', undefined, 5);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(mockMemory.id);
    });

    test('should fall back to text search when hybrid search returns empty results', async () => {
      hybridSearchMock.mockImplementation(async () => []);

      await memoryService.recall({ query: 'no match', workspaceId: 'ws-1' });

      expect(repoMocks.search).toHaveBeenCalledTimes(1);
    });

    test('should pass agentId and limit to hybrid search', async () => {
      await memoryService.recall({ query: 'test', workspaceId: 'ws-1', agentId: 'agent-1', limit: 10 });

      expect(hybridSearchMock).toHaveBeenCalledWith('test', 'ws-1', 'agent-1', 10);
    });

    test('should default limit to 5', async () => {
      await memoryService.recall({ query: 'test', workspaceId: 'ws-1' });

      expect(hybridSearchMock).toHaveBeenCalledWith('test', 'ws-1', undefined, 5);
    });

    test('should filter out undefined memories from hybrid search results', async () => {
      hybridSearchMock.mockImplementation(async () => [{ id: 'mem-1', score: 0.9 }, { id: 'mem-missing', score: 0.5 }]);
      repoMocks.get.mockImplementation(async (id: string) => id === 'mem-1' ? mockMemory : undefined);

      const results = await memoryService.recall({ query: 'test', workspaceId: 'ws-1' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mem-1');
    });

    test('should pass agentId and limit to text search fallback', async () => {
      hybridSearchMock.mockImplementation(async () => { throw new Error('fail'); });

      await memoryService.recall({ query: 'test', workspaceId: 'ws-1', agentId: 'agent-1', limit: 3 });

      expect(repoMocks.search).toHaveBeenCalledWith('test', 'ws-1', 'agent-1', 3);
    });

    // ---- Staleness assertions ----

    test('memory 31+ days old → stale: true', async () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const staleMemory: typeof mockMemory = { ...mockMemory, id: 'mem-stale', updatedAt: oldDate };
      hybridSearchMock.mockImplementation(async () => [{ id: 'mem-stale', score: 0.9 }]);
      repoMocks.get.mockImplementation(async () => staleMemory);

      const results = await memoryService.recall({ query: 'stale', workspaceId: 'ws-1' });

      expect(results[0].stale).toBe(true);
      expect(results[0].staleDays).toBeGreaterThanOrEqual(31);
    });

    test('memory updated today → stale: false, staleDays === 0', async () => {
      const freshMemory: typeof mockMemory = { ...mockMemory, id: 'mem-fresh', updatedAt: new Date() };
      hybridSearchMock.mockImplementation(async () => [{ id: 'mem-fresh', score: 0.9 }]);
      repoMocks.get.mockImplementation(async () => freshMemory);

      const results = await memoryService.recall({ query: 'fresh', workspaceId: 'ws-1' });

      expect(results[0].stale).toBe(false);
      expect(results[0].staleDays).toBe(0);
    });

    test('memory exactly 30 days old → stale: false (threshold is > 30)', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const borderMemory: typeof mockMemory = { ...mockMemory, id: 'mem-30', updatedAt: thirtyDaysAgo };
      hybridSearchMock.mockImplementation(async () => [{ id: 'mem-30', score: 0.9 }]);
      repoMocks.get.mockImplementation(async () => borderMemory);

      const results = await memoryService.recall({ query: 'border', workspaceId: 'ws-1' });

      expect(results[0].stale).toBe(false);
      expect(results[0].staleDays).toBe(30);
    });

    test('scope is "agent" when agentId set, "workspace" when not', async () => {
      // memory with agentId
      const agentMemory: typeof mockMemory = { ...mockMemory, id: 'mem-agent', agentId: 'agent-42', updatedAt: new Date() };
      // memory without agentId
      const workspaceMemory: typeof mockMemory = { ...mockMemory, id: 'mem-ws', agentId: undefined as unknown as string, updatedAt: new Date() };

      hybridSearchMock.mockImplementation(async () => [
        { id: 'mem-agent', score: 0.9 },
        { id: 'mem-ws', score: 0.8 },
      ]);
      repoMocks.get.mockImplementation(async (id: string) =>
        id === 'mem-agent' ? agentMemory : workspaceMemory,
      );

      const results = await memoryService.recall({ query: 'scope', workspaceId: 'ws-1' });

      const agentResult = results.find((r) => r.id === 'mem-agent');
      const wsResult = results.find((r) => r.id === 'mem-ws');
      expect(agentResult?.scope).toBe('agent');
      expect(wsResult?.scope).toBe('workspace');
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      resetMocks();
      repoMocks.list.mockImplementation(async () => [mockMemory]);
    });

    test('should delegate to repo.list and return results', async () => {
      const results = await memoryService.list('ws-1');

      expect(repoMocks.list).toHaveBeenCalledTimes(1);
      expect(repoMocks.list).toHaveBeenCalledWith('ws-1', undefined);
      expect(results).toEqual([mockMemory]);
    });

    test('should pass agentId when provided', async () => {
      await memoryService.list('ws-1', 'agent-1');

      expect(repoMocks.list).toHaveBeenCalledWith('ws-1', 'agent-1');
    });

    test('should return empty array when repo returns none', async () => {
      repoMocks.list.mockImplementation(async () => []);

      const results = await memoryService.list('ws-empty');

      expect(results).toEqual([]);
    });
  });

  describe('forget()', () => {
    beforeEach(() => {
      resetMocks();
      repoMocks.delete.mockImplementation(async () => true);
    });

    test('should delegate to repo.delete and return true on success', async () => {
      const result = await memoryService.forget('mem-1');

      expect(repoMocks.delete).toHaveBeenCalledTimes(1);
      expect(repoMocks.delete).toHaveBeenCalledWith('mem-1');
      expect(result).toBe(true);
    });

    test('should return false when repo reports memory not found', async () => {
      repoMocks.delete.mockImplementation(async () => false);

      const result = await memoryService.forget('mem-nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('propose()', () => {
    beforeEach(() => {
      resetMocks();
      repoMocks.createProposal.mockImplementation(async () => mockProposal);
    });

    test('should create proposal via repo and return it', async () => {
      const input = { workspaceId: 'ws-1', agentId: 'agent-1', type: 'pattern' as const, title: 'Proposed Memory', content: 'Pattern content' };
      const result = await memoryService.propose(input);

      expect(repoMocks.createProposal).toHaveBeenCalledTimes(1);
      expect(repoMocks.createProposal).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockProposal);
    });

    test('should emit MemoryProposal event with proposal fields', async () => {
      const input = { workspaceId: 'ws-1', agentId: 'agent-1', type: 'domain' as const, title: 'Proposed Memory', content: 'Content' };
      await memoryService.propose(input);

      expect(eventMocks.emitMemoryProposal).toHaveBeenCalledTimes(1);
      expect(eventMocks.emitMemoryProposal).toHaveBeenCalledWith({
        id: mockProposal.id,
        workspaceId: mockProposal.workspaceId,
        agentId: mockProposal.agentId,
        title: mockProposal.title,
      });
    });

    test('should return proposal with pending status', async () => {
      const input = { workspaceId: 'ws-1', agentId: 'agent-1', type: 'reference' as const, title: 'Ref', content: 'Content' };
      const result = await memoryService.propose(input);

      expect(result.status).toBe('pending');
    });
  });

  describe('approveProposal()', () => {
    beforeEach(() => {
      resetMocks();
      repoMocks.approveProposal.mockImplementation(async () => mockMemory);
    });

    test('should approve proposal via repo and return the resulting memory', async () => {
      const result = await memoryService.approveProposal('prop-1');

      expect(repoMocks.approveProposal).toHaveBeenCalledTimes(1);
      expect(repoMocks.approveProposal).toHaveBeenCalledWith('prop-1');
      expect(result).toEqual(mockMemory);
    });

    test('should emit MemoryApproved event with correct ids', async () => {
      await memoryService.approveProposal('prop-1');

      expect(eventMocks.emitMemoryApproved).toHaveBeenCalledTimes(1);
      expect(eventMocks.emitMemoryApproved).toHaveBeenCalledWith(mockMemory.id, 'prop-1', mockMemory.workspaceId);
    });
  });

  describe('rejectProposal()', () => {
    beforeEach(() => {
      resetMocks();
      repoMocks.getProposal.mockImplementation(async () => mockProposal);
      repoMocks.rejectProposal.mockImplementation(async () => undefined);
    });

    test('should reject proposal via repo and emit event', async () => {
      await memoryService.rejectProposal('prop-1', 'Not accurate');

      expect(repoMocks.getProposal).toHaveBeenCalledWith('prop-1');
      expect(repoMocks.rejectProposal).toHaveBeenCalledWith('prop-1', 'Not accurate');
      expect(eventMocks.emitMemoryRejected).toHaveBeenCalledTimes(1);
      expect(eventMocks.emitMemoryRejected).toHaveBeenCalledWith('prop-1', mockProposal.workspaceId, 'Not accurate');
    });

    test('should work without a rejection reason', async () => {
      await memoryService.rejectProposal('prop-1');

      expect(repoMocks.rejectProposal).toHaveBeenCalledWith('prop-1', undefined);
      expect(eventMocks.emitMemoryRejected).toHaveBeenCalledWith('prop-1', mockProposal.workspaceId, undefined);
    });

    test('should throw when proposal does not exist', async () => {
      repoMocks.getProposal.mockImplementation(async () => undefined);

      await expect(memoryService.rejectProposal('prop-missing')).rejects.toThrow('Proposal not found: prop-missing');
    });

    test('should not call rejectProposal on repo when proposal is not found', async () => {
      repoMocks.getProposal.mockImplementation(async () => undefined);

      try {
        await memoryService.rejectProposal('prop-missing');
      } catch {
        // expected
      }

      expect(repoMocks.rejectProposal).not.toHaveBeenCalled();
      expect(eventMocks.emitMemoryRejected).not.toHaveBeenCalled();
    });
  });
});
