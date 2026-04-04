import { memoryRepo } from './memory.repo';
import { emitMemorySaved, emitMemoryProposal, emitMemoryApproved, emitMemoryRejected } from './memory.events';
import type { AgentMemory, MemoryProposal, SaveMemoryInput, ProposeMemoryInput, RecallInput } from './memory.types';

export const memoryService = {
  async save(input: SaveMemoryInput): Promise<AgentMemory> {
    const memory = await memoryRepo.save(input);
    emitMemorySaved(memory.id, memory.workspaceId);
    return memory;
  },

  async recall(input: RecallInput): Promise<AgentMemory[]> {
    return memoryRepo.search(input.query, input.workspaceId, input.agentId, input.limit ?? 5);
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
