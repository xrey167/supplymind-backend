/** In-memory store for pending tool approval promises keyed by approvalId. */

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  workspaceId: string;
}

const pendingApprovals = new Map<string, PendingApproval>();

/**
 * Creates a promise that resolves when the approval is resolved or times out.
 * On timeout, the approval is denied (resolves false).
 */
export function createApprovalRequest(approvalId: string, workspaceId: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve(false); // timeout = deny
    }, timeoutMs);
    pendingApprovals.set(approvalId, { resolve, timer, workspaceId });
  });
}

/**
 * Resolves a pending approval request.
 * Returns true if the approval was found and resolved, false if it was not found (expired, unknown,
 * or workspaceId mismatch — prevents cross-workspace approval injection).
 */
export function resolveApproval(approvalId: string, workspaceId: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending || pending.workspaceId !== workspaceId) return false;
  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  pending.resolve(approved);
  return true;
}

/** Returns the number of currently pending approvals (for observability). */
export function pendingApprovalCount(): number {
  return pendingApprovals.size;
}
