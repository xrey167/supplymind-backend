/** In-memory store for pending task input requests keyed by taskId. */
import { logger } from '../../config/logger';

interface PendingInput {
  resolve: (input: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  workspaceId: string;
  prompt: string;
}

const pendingInputs = new Map<string, PendingInput>();

/**
 * Creates a promise that resolves when user input is received or times out.
 * On timeout, resolves with `null` (no input).
 */
export function createInputRequest(
  taskId: string,
  workspaceId: string,
  prompt: string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      pendingInputs.delete(taskId);
      logger.warn({ taskId, workspaceId }, 'Task input request timed out');
      resolve(null);
    }, timeoutMs);
    pendingInputs.set(taskId, { resolve, timer, workspaceId, prompt });
  });
}

/**
 * Resolves a pending input request with user-provided data.
 * Returns true if the input was found and resolved, false otherwise.
 * Prevents cross-workspace input injection.
 */
export function resolveInput(taskId: string, workspaceId: string, input: unknown): boolean {
  const pending = pendingInputs.get(taskId);
  if (!pending) return false;
  if (pending.workspaceId !== workspaceId) {
    logger.warn(
      { taskId, requestedWorkspaceId: workspaceId, expectedWorkspaceId: pending.workspaceId },
      'Cross-workspace task input attempt rejected',
    );
    return false;
  }
  clearTimeout(pending.timer);
  pendingInputs.delete(taskId);
  pending.resolve(input);
  return true;
}

/** Returns the number of currently pending input requests (for observability). */
export function pendingInputCount(): number {
  return pendingInputs.size;
}
