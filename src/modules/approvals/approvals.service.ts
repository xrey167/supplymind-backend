import type { ApprovalItem } from './approvals.types';
import type { MemoryProposal } from '../memory/memory.types';
import type { ExecutionPlanRow } from '../execution/execution.types';

function memoryProposalToApproval(p: MemoryProposal): ApprovalItem {
  return {
    id: p.id,
    kind: 'memory_proposal',
    workspaceId: p.workspaceId,
    title: p.title,
    summary: p.content,
    status: p.status,
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt,
    metadata: { agentId: p.agentId, type: p.type, evidence: p.evidence },
  };
}

function executionPlanToApproval(p: ExecutionPlanRow): ApprovalItem {
  return {
    id: p.id,
    kind: 'execution_plan',
    workspaceId: p.workspaceId,
    title: p.name ?? p.id,
    summary: `Execution plan (${p.steps.length} steps)`,
    status: p.status,
    createdAt: p.createdAt,
    reviewedAt: p.updatedAt,
    metadata: { intent: p.intent, policy: p.policy, createdBy: p.createdBy },
  };
}

export const approvalsService = {
  async list(workspaceId: string, filters?: { status?: string; kind?: string }): Promise<ApprovalItem[]> {
    const items: ApprovalItem[] = [];

    const includeMemory = !filters?.kind || filters.kind === 'memory_proposal';
    const includeExecution = !filters?.kind || filters.kind === 'execution_plan';

    if (includeMemory) {
      const { memoryService } = await import('../memory/memory.service');
      const memoryStatus = filters?.status === 'pending_approval' ? 'pending' : filters?.status;
      const proposals = await memoryService.listProposals(workspaceId, memoryStatus);
      items.push(...proposals.map(memoryProposalToApproval));
    }

    if (includeExecution) {
      const { executionService } = await import('../execution/execution.service');
      if (filters?.status === 'pending' || filters?.status === 'pending_approval' || !filters?.status) {
        const plans = await executionService.listByStatus(workspaceId, 'pending_approval');
        items.push(...plans.map(executionPlanToApproval));
      } else {
        const plans = await executionService.list(workspaceId);
        items.push(...plans.filter(p => p.status === filters.status).map(executionPlanToApproval));
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items;
  },

  async act(
    workspaceId: string,
    kind: 'memory_proposal' | 'execution_plan',
    id: string,
    action: 'approve' | 'reject' | 'rollback',
    callerId: string,
    reason?: string,
  ): Promise<{ ok: boolean; detail?: string }> {
    if (kind === 'memory_proposal') {
      const { memoryService } = await import('../memory/memory.service');
      switch (action) {
        case 'approve': {
          await memoryService.approveProposal(id, workspaceId);
          return { ok: true };
        }
        case 'reject': {
          await memoryService.rejectProposal(id, workspaceId, reason);
          return { ok: true };
        }
        case 'rollback': {
          await memoryService.rollbackApproval(id, workspaceId);
          return { ok: true };
        }
      }
    }

    if (kind === 'execution_plan') {
      const { executionService } = await import('../execution/execution.service');
      switch (action) {
        case 'approve': {
          const result = await executionService.approve(workspaceId, id, callerId);
          if (!result.ok) return { ok: false, detail: result.error.message };
          return { ok: true };
        }
        case 'reject': {
          const result = await executionService.reject(workspaceId, id, callerId, reason);
          if (!result.ok) return { ok: false, detail: result.error.message };
          return { ok: true };
        }
        case 'rollback': {
          return { ok: false, detail: 'Rollback not supported for execution plans' };
        }
      }
    }

    return { ok: false, detail: `Unknown kind: ${kind}` };
  },
};
