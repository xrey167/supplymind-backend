/** In-memory store for pending orchestration gate promises keyed by gateId. */
import { logger } from '../../config/logger';

interface PendingGate {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  workspaceId: string;
  orchestrationId: string;
  stepId: string;
}

const pendingGates = new Map<string, PendingGate>();

/** Build a composite key for a gate from orchestrationId + stepId. */
export function gateKey(orchestrationId: string, stepId: string): string {
  return `${orchestrationId}:${stepId}`;
}

/**
 * Creates a promise that resolves when the gate is approved/denied or times out.
 * On timeout, the gate is denied (resolves false).
 */
export function createGateRequest(
  orchestrationId: string,
  stepId: string,
  workspaceId: string,
  timeoutMs: number,
): Promise<boolean> {
  const key = gateKey(orchestrationId, stepId);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingGates.delete(key);
      logger.warn({ orchestrationId, stepId, workspaceId }, 'Orchestration gate timed out — denying');
      resolve(false);
    }, timeoutMs);
    pendingGates.set(key, { resolve, timer, workspaceId, orchestrationId, stepId });
  });
}

/**
 * Resolves a pending gate request.
 * Returns true if the gate was found and resolved, false otherwise.
 * Prevents cross-workspace gate injection.
 */
export function resolveGate(
  orchestrationId: string,
  stepId: string,
  workspaceId: string,
  approved: boolean,
): boolean {
  const key = gateKey(orchestrationId, stepId);
  const pending = pendingGates.get(key);
  if (!pending) return false;
  if (pending.workspaceId !== workspaceId) {
    logger.warn(
      { orchestrationId, stepId, requestedWorkspaceId: workspaceId, expectedWorkspaceId: pending.workspaceId },
      'Cross-workspace orchestration gate attempt rejected',
    );
    return false;
  }
  clearTimeout(pending.timer);
  pendingGates.delete(key);
  pending.resolve(approved);
  return true;
}

/** Returns the number of currently pending gates (for observability). */
export function pendingGateCount(): number {
  return pendingGates.size;
}
