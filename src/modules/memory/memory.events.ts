import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

export function emitMemorySaved(memoryId: string, workspaceId: string): void {
  eventBus.publish(Topics.MEMORY_SAVED, { memoryId, workspaceId });
}

export function emitMemoryProposal(proposal: { id: string; workspaceId: string; agentId: string; title: string }): void {
  eventBus.publish(Topics.MEMORY_PROPOSAL, proposal);
}

export function emitMemoryApproved(memoryId: string, proposalId: string, workspaceId: string): void {
  eventBus.publish(Topics.MEMORY_APPROVED, { memoryId, proposalId, workspaceId });
}

export function emitMemoryRejected(proposalId: string, workspaceId: string, reason?: string): void {
  eventBus.publish(Topics.MEMORY_REJECTED, { proposalId, workspaceId, reason });
}
