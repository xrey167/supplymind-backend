import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import type { AgentMemory, MemoryProposal } from '../memory.types';
import { Topics } from '../../../events/topics';

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

// Re-export real memory.events so other files' mock.module doesn't replace them with no-ops.
// memory.service calls emitMemorySaved etc. which internally call eventBus.publish — we spy on that.
mock.module('../memory.events', () => {
  const { eventBus } = require('../../../events/bus');
  const { Topics } = require('../../../events/topics');
  return {
    emitMemorySaved: (memoryId: string, workspaceId: string) =>
      eventBus.publish(Topics.MEMORY_SAVED, { memoryId, workspaceId }),
    emitMemoryProposal: (proposal: any) =>
      eventBus.publish(Topics.MEMORY_PROPOSAL, proposal),
    emitMemoryApproved: (memoryId: string, proposalId: string, workspaceId: string) =>
      eventBus.publish(Topics.MEMORY_APPROVED, { memoryId, proposalId, workspaceId }),
    emitMemoryRejected: (proposalId: string, workspaceId: string, reason?: string) =>
      eventBus.publish(Topics.MEMORY_REJECTED, { proposalId, workspaceId, reason }),
  };
});

// --- Mock dynamic imports ---
// memory.service uses these via `await import(...)` so mock.module is safe here

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

const hybridSearchMock = mock(async () => [{ id: 'mem-1', score: 0.9 }]);

mock.module('../memory.search', () => ({
  hybridSearch: hybridSearchMock,
}));

// --- Imports ---
// memoryRepo and eventBus are spied on directly; no mock.module needed for static imports
import { memoryService } from '../memory.service';
import { memoryRepo } from '../memory.repo';
import { eventBus } from '../../../events/bus';

// --- Tests ---

describe('memoryService', () => {
  afterEach(() => {
    mock.restore();
  });

  describe('save()', () => {
    beforeEach(() => {
      spyOn(memoryRepo, 'save').mockResolvedValue(mockMemory);
      spyOn(eventBus, 'publish').mockResolvedValue(undefined);
      embedMock.mockClear().mockImplementation(async () => [0.1, 0.2, 0.3]);
      upsertMock.mockClear().mockImplementation(async () => undefined);
    });

    test('should save via repo and return the memory', async () => {
      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      const result = await memoryService.save(input);

      expect(memoryRepo.save).toHaveBeenCalledTimes(1);
      expect(memoryRepo.save).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockMemory);
    });

    test('should emit MemorySaved event with correct ids', async () => {
      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      await memoryService.save(input);

      expect(eventBus.publish).toHaveBeenCalledWith(Topics.MEMORY_SAVED, {
        memoryId: mockMemory.id,
        workspaceId: mockMemory.workspaceId,
      });
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
      expect(eventBus.publish).toHaveBeenCalledWith(Topics.MEMORY_SAVED, expect.any(Object));
    });

    test('should still save and emit event when vector store upsert fails', async () => {
      upsertMock.mockImplementation(async () => { throw new Error('pgvector unavailable'); });

      const input = { workspaceId: 'ws-1', type: 'domain' as const, title: 'Test Memory', content: 'Some content' };
      const result = await memoryService.save(input);

      expect(result).toEqual(mockMemory);
      expect(eventBus.publish).toHaveBeenCalledWith(Topics.MEMORY_SAVED, expect.any(Object));
    });

    test('should include agentId when provided', async () => {
      const input = { workspaceId: 'ws-1', agentId: 'agent-42', type: 'feedback' as const, title: 'Feedback', content: 'Good run' };
      await memoryService.save(input);

      expect(memoryRepo.save).toHaveBeenCalledWith(input);
    });
  });

  describe('recall()', () => {
    beforeEach(() => {
      spyOn(memoryRepo, 'get').mockResolvedValue(mockMemory);
      spyOn(memoryRepo, 'search').mockResolvedValue([mockMemory]);
      hybridSearchMock.mockClear().mockImplementation(async () => [{ id: 'mem-1', score: 0.9 }]);
    });

    test('should return memories via hybrid search when it succeeds and returns results', async () => {
      const results = await memoryService.recall({ query: 'supply chain', workspaceId: 'ws-1' });

      expect(hybridSearchMock).toHaveBeenCalledTimes(1);
      expect(hybridSearchMock).toHaveBeenCalledWith('supply chain', 'ws-1', undefined, 5);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(mockMemory);
    });

    test('should fall back to text search when hybrid search throws', async () => {
      hybridSearchMock.mockImplementation(async () => { throw new Error('pgvector down'); });

      const results = await memoryService.recall({ query: 'supply chain', workspaceId: 'ws-1' });

      expect(memoryRepo.search).toHaveBeenCalledTimes(1);
      expect(memoryRepo.search).toHaveBeenCalledWith('supply chain', 'ws-1', undefined, 5);
      expect(results).toEqual([mockMemory]);
    });

    test('should fall back to text search when hybrid search returns empty results', async () => {
      hybridSearchMock.mockImplementation(async () => []);

      await memoryService.recall({ query: 'no match', workspaceId: 'ws-1' });

      expect(memoryRepo.search).toHaveBeenCalledTimes(1);
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
      (memoryRepo.get as ReturnType<typeof spyOn>).mockImplementation(async (id: string) => id === 'mem-1' ? mockMemory : undefined);

      const results = await memoryService.recall({ query: 'test', workspaceId: 'ws-1' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mem-1');
    });

    test('should pass agentId and limit to text search fallback', async () => {
      hybridSearchMock.mockImplementation(async () => { throw new Error('fail'); });

      await memoryService.recall({ query: 'test', workspaceId: 'ws-1', agentId: 'agent-1', limit: 3 });

      expect(memoryRepo.search).toHaveBeenCalledWith('test', 'ws-1', 'agent-1', 3);
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      spyOn(memoryRepo, 'list').mockResolvedValue([mockMemory]);
    });

    test('should delegate to repo.list and return results', async () => {
      const results = await memoryService.list('ws-1');

      expect(memoryRepo.list).toHaveBeenCalledTimes(1);
      expect(memoryRepo.list).toHaveBeenCalledWith('ws-1', undefined);
      expect(results).toEqual([mockMemory]);
    });

    test('should pass agentId when provided', async () => {
      await memoryService.list('ws-1', 'agent-1');

      expect(memoryRepo.list).toHaveBeenCalledWith('ws-1', 'agent-1');
    });

    test('should return empty array when repo returns none', async () => {
      (memoryRepo.list as ReturnType<typeof spyOn>).mockResolvedValue([]);

      const results = await memoryService.list('ws-empty');

      expect(results).toEqual([]);
    });
  });

  describe('forget()', () => {
    beforeEach(() => {
      spyOn(memoryRepo, 'delete').mockResolvedValue(true);
    });

    test('should delegate to repo.delete and return true on success', async () => {
      const result = await memoryService.forget('mem-1');

      expect(memoryRepo.delete).toHaveBeenCalledTimes(1);
      expect(memoryRepo.delete).toHaveBeenCalledWith('mem-1');
      expect(result).toBe(true);
    });

    test('should return false when repo reports memory not found', async () => {
      (memoryRepo.delete as ReturnType<typeof spyOn>).mockResolvedValue(false);

      const result = await memoryService.forget('mem-nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('propose()', () => {
    beforeEach(() => {
      spyOn(memoryRepo, 'createProposal').mockResolvedValue(mockProposal);
      spyOn(eventBus, 'publish').mockResolvedValue(undefined);
    });

    test('should create proposal via repo and return it', async () => {
      const input = { workspaceId: 'ws-1', agentId: 'agent-1', type: 'pattern' as const, title: 'Proposed Memory', content: 'Pattern content' };
      const result = await memoryService.propose(input);

      expect(memoryRepo.createProposal).toHaveBeenCalledTimes(1);
      expect(memoryRepo.createProposal).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockProposal);
    });

    test('should emit MemoryProposal event with proposal fields', async () => {
      const input = { workspaceId: 'ws-1', agentId: 'agent-1', type: 'domain' as const, title: 'Proposed Memory', content: 'Content' };
      await memoryService.propose(input);

      expect(eventBus.publish).toHaveBeenCalledWith(Topics.MEMORY_PROPOSAL, {
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
      spyOn(memoryRepo, 'approveProposal').mockResolvedValue(mockMemory);
      spyOn(eventBus, 'publish').mockResolvedValue(undefined);
    });

    test('should approve proposal via repo and return the resulting memory', async () => {
      const result = await memoryService.approveProposal('prop-1');

      expect(memoryRepo.approveProposal).toHaveBeenCalledTimes(1);
      expect(memoryRepo.approveProposal).toHaveBeenCalledWith('prop-1');
      expect(result).toEqual(mockMemory);
    });

    test('should emit MemoryApproved event with correct ids', async () => {
      await memoryService.approveProposal('prop-1');

      expect(eventBus.publish).toHaveBeenCalledWith(Topics.MEMORY_APPROVED, {
        memoryId: mockMemory.id,
        proposalId: 'prop-1',
        workspaceId: mockMemory.workspaceId,
      });
    });
  });

  describe('rejectProposal()', () => {
    beforeEach(() => {
      spyOn(memoryRepo, 'getProposal').mockResolvedValue(mockProposal);
      spyOn(memoryRepo, 'rejectProposal').mockResolvedValue(undefined);
      spyOn(eventBus, 'publish').mockResolvedValue(undefined);
    });

    test('should reject proposal via repo and emit event', async () => {
      await memoryService.rejectProposal('prop-1', 'Not accurate');

      expect(memoryRepo.getProposal).toHaveBeenCalledWith('prop-1');
      expect(memoryRepo.rejectProposal).toHaveBeenCalledWith('prop-1', 'Not accurate');
      expect(eventBus.publish).toHaveBeenCalledWith(Topics.MEMORY_REJECTED, {
        proposalId: 'prop-1',
        workspaceId: mockProposal.workspaceId,
        reason: 'Not accurate',
      });
    });

    test('should work without a rejection reason', async () => {
      await memoryService.rejectProposal('prop-1');

      expect(memoryRepo.rejectProposal).toHaveBeenCalledWith('prop-1', undefined);
      expect(eventBus.publish).toHaveBeenCalledWith(Topics.MEMORY_REJECTED, {
        proposalId: 'prop-1',
        workspaceId: mockProposal.workspaceId,
        reason: undefined,
      });
    });

    test('should throw when proposal does not exist', async () => {
      (memoryRepo.getProposal as ReturnType<typeof spyOn>).mockResolvedValue(undefined);

      await expect(memoryService.rejectProposal('prop-missing')).rejects.toThrow('Proposal not found: prop-missing');
    });

    test('should not call rejectProposal on repo when proposal is not found', async () => {
      (memoryRepo.getProposal as ReturnType<typeof spyOn>).mockResolvedValue(undefined);

      try {
        await memoryService.rejectProposal('prop-missing');
      } catch {
        // expected
      }

      expect(memoryRepo.rejectProposal).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalledWith(Topics.MEMORY_REJECTED, expect.any(Object));
    });
  });
});
