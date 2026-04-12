/** Unified approval item — aggregates memory proposals and execution plan approvals. */
export interface ApprovalItem {
  id: string;
  kind: 'memory_proposal' | 'execution_plan';
  workspaceId: string;
  title: string;
  summary: string;
  status: string;
  createdAt: Date;
  reviewedAt?: Date | null;
  metadata: Record<string, unknown>;
}

export interface ApprovalAction {
  action: 'approve' | 'reject' | 'rollback';
  reason?: string;
}
