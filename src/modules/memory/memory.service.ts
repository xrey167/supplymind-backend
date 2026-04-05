import { memoryRepo } from './memory.repo';
import { logger } from '../../config/logger';
import { emitMemorySaved, emitMemoryProposal, emitMemoryApproved, emitMemoryRejected } from './memory.events';
import type { AgentMemory, MemoryProposal, RecallResult, SaveMemoryInput, ProposeMemoryInput, RecallInput } from './memory.types';

const STALENESS_THRESHOLD_DAYS = 30;

function daysSince(date: Date | string | null | undefined): number {
  if (!date) return 0;
  const ms = new Date(date).getTime();
  if (isNaN(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24)));
}

function toRecallResult(m: AgentMemory): RecallResult {
  const updatedAt = m.updatedAt instanceof Date ? m.updatedAt.toISOString() : String(m.updatedAt);
  const staleDays = daysSince(updatedAt);
  return {
    ...m,
    updatedAt,
    scope: m.agentId ? 'agent' : 'workspace',
    stale: staleDays > STALENESS_THRESHOLD_DAYS,
    staleDays,
  };
}

export const memoryService = {
  async save(input: SaveMemoryInput): Promise<AgentMemory> {
    const memory = await memoryRepo.save(input);
    // Generate embedding async (best-effort)
    try {
      const { getEmbeddingProvider } = await import('./memory.embedding');
      const { PgVectorMemoryStore } = await import('./memory.store');
      const provider = getEmbeddingProvider();
      const embedding = await provider.embed(`${input.title}: ${input.content}`);
      const store = new PgVectorMemoryStore();
      await store.upsert(memory.id, memory.content, embedding, memory.metadata);
    } catch (err) {
      logger.error({ memoryId: memory.id, workspaceId: input.workspaceId, error: err instanceof Error ? err.message : String(err) }, 'Embedding generation failed, memory saved without vector');
    }
    emitMemorySaved(memory.id, memory.workspaceId);
    return memory;
  },

  async recall(input: RecallInput): Promise<RecallResult[]> {
    try {
      const { hybridSearch } = await import('./memory.search');
      const results = await hybridSearch(input.query, input.workspaceId, input.agentId, input.limit ?? 5);
      if (results.length > 0) {
        const memories = await Promise.all(results.map((r) => memoryRepo.get(r.id)));
        return memories.filter((m): m is AgentMemory => m !== undefined).map(toRecallResult);
      }
    } catch (err) {
      logger.warn({ query: input.query, workspaceId: input.workspaceId, error: err instanceof Error ? err.message : String(err) }, 'Hybrid search failed, falling back to text-only');
    }
    const memories = await memoryRepo.search(input.query, input.workspaceId, input.agentId, input.limit ?? 5);
    return memories.map(toRecallResult);
  },

  async list(workspaceId: string, agentId?: string): Promise<AgentMemory[]> {
    return memoryRepo.list(workspaceId, agentId);
  },

  async forget(memoryId: string): Promise<boolean> {
    return memoryRepo.delete(memoryId);
  },

  async propose(input: ProposeMemoryInput): Promise<MemoryProposal> {
    const proposal = await memoryRepo.createProposal(input);
    emitMemoryProposal({ id: proposal.id, workspaceId: proposal.workspaceId, agentId: proposal.agentId, title: proposal.title });
    return proposal;
  },

  async approveProposal(proposalId: string): Promise<AgentMemory> {
    const memory = await memoryRepo.approveProposal(proposalId);
    emitMemoryApproved(memory.id, proposalId, memory.workspaceId);
    return memory;
  },

  async rejectProposal(proposalId: string, reason?: string): Promise<void> {
    const proposal = await memoryRepo.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    await memoryRepo.rejectProposal(proposalId, reason);
    emitMemoryRejected(proposalId, proposal.workspaceId, reason);
  },
};
