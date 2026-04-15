/** In-memory store for pending tool approval promises keyed by approvalId. */
import { logger } from '../../config/logger';

export interface ApprovalResult {
  approved: boolean;
  /** When approved, the user may modify the tool args before execution. */
  updatedInput?: Record<string, unknown>;
}

interface PendingApproval {
  resolve: (result: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
  workspaceId: string;
}

const pendingApprovals = new Map<string, PendingApproval>();

/**
 * Creates a promise that resolves when the approval is resolved or times out.
 * On timeout, the approval is denied (resolves { approved: false }).
 */
export function createApprovalRequest(approvalId: string, workspaceId: string, timeoutMs: number): Promise<ApprovalResult> {
  return new Promise<ApprovalResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      logger.warn({ approvalId, workspaceId }, 'Tool approval timed out — denying tool call');
      resolve({ approved: false }); // timeout = deny
    }, timeoutMs);
    pendingApprovals.set(approvalId, { resolve, timer, workspaceId });
  });
}

/**
 * Resolves a pending approval request.
 * Returns true if the approval was found and resolved, false if it was not found (expired, unknown,
 * or workspaceId mismatch — prevents cross-workspace approval injection).
 *
 * When `updatedInput` is provided and approved=true, the tool args are replaced before execution.
 */
export function resolveApproval(
  approvalId: string,
  workspaceId: string,
  approved: boolean,
  updatedInput?: Record<string, unknown>,
): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  if (pending.workspaceId !== workspaceId) {
    logger.warn({ approvalId, requestedWorkspaceId: workspaceId, expectedWorkspaceId: pending.workspaceId }, 'Cross-workspace tool approval attempt rejected');
    return false;
  }
  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  pending.resolve({ approved, updatedInput: approved ? updatedInput : undefined });
  return true;
}

/**
 * Cancels a pending approval without approving or denying.
 * Useful when the user navigates away or the request is no longer relevant.
 * Resolves as denied.
 */
export function cancelApproval(approvalId: string, workspaceId: string): boolean {
  return resolveApproval(approvalId, workspaceId, false);
}

/** Returns the number of currently pending approvals (for observability). */
export function pendingApprovalCount(): number {
  return pendingApprovals.size;
}
