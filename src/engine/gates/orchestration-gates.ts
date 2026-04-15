/** In-memory store for pending orchestration gate promises keyed by gateId. */
import { logger } from '../../config/logger';
import { getSharedRedisClient } from '../../infra/redis/client';
import { gateAuditRepo } from './gate-audit.repo';
import { emitGateResolved } from '../../modules/orchestration/orchestration.events';

/** Lazily access the shared Redis client — avoids a top-level import that would
 *  fail in unit tests where Redis is mocked after module load. */
function redis() {
  return getSharedRedisClient();
}

function redisGateKey(orchestrationId: string, stepId: string): string {
  return `gate:${orchestrationId}:${stepId}`;
}

function parseGateRaw(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

// NOTE: GET-then-SET with KEEPTTL has a narrow TOCTOU race — if the key expires
// between GET and SET, the SET recreates it without TTL. Acceptable for observability-
// only data; gate resolution correctness uses the in-memory path.
async function mutateGateMetadata(
  key: string,
  mutate: (parsed: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<void> {
  const parsed = parseGateRaw(await redis().get(key));
  if (!parsed) return;
  const next = mutate(parsed);
  if (!next) return;
  await redis().set(key, JSON.stringify(next), 'KEEPTTL');
}

interface PendingGate {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  workspaceId: string;
  orchestrationId: string;
  stepId: string;
  prompt: string;
}

const pendingGates = new Map<string, PendingGate>();

/** Build a composite key for a gate from orchestrationId + stepId. */
export function gateKey(orchestrationId: string, stepId: string): string {
  return `${orchestrationId}:${stepId}`;
}

/**
 * Metadata shape persisted to Redis for observability and recovery.
 */
export interface GateMetadata {
  orchestrationId: string;
  stepId: string;
  workspaceId: string;
  prompt: string;
  createdAt: string;
  timeoutAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  decidedAt?: string;
  decidedBy?: string;
}

/**
 * Creates a promise that resolves when the gate is approved/denied or times out.
 * On timeout, the gate is denied (resolves false).
 *
 * Redis is written fire-and-forget; failures never block or throw.
 */
export function createGateRequest(
  orchestrationId: string,
  stepId: string,
  workspaceId: string,
  timeoutMs: number,
  prompt: string = 'Approval required to continue',
): Promise<boolean> {
  const key = gateKey(orchestrationId, stepId);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingGates.delete(key);
      logger.warn({ orchestrationId, stepId, workspaceId }, 'Orchestration gate timed out — denying');
      resolve(false);

      // Update Redis status to 'timeout' (fire-and-forget)
      mutateGateMetadata(redisGateKey(orchestrationId, stepId), (parsed) => {
        if (parsed.status !== 'pending') return null;
        return { ...parsed, status: 'timeout', decidedAt: new Date().toISOString(), decidedBy: 'system' };
      }).catch(() => {});

      // Persist audit record (fire-and-forget)
      gateAuditRepo.insert({
        orchestrationId,
        stepId,
        workspaceId,
        outcome: 'timeout',
        decidedBy: 'system',
        prompt,
      }).catch((err: unknown) => logger.warn({ err }, 'Failed to write gate audit timeout record'));

      // Emit real-time event (fire-and-forget — emitGateResolved catches its own errors)
      emitGateResolved(orchestrationId, stepId, 'timeout', workspaceId);
    }, timeoutMs);

    pendingGates.set(key, { resolve, timer, workspaceId, orchestrationId, stepId, prompt });

    // Write gate metadata to Redis (fire-and-forget)
    const redisTtlSec = Math.ceil(timeoutMs / 1000) + 10;
    redis().set(
      redisGateKey(orchestrationId, stepId),
      JSON.stringify({
        workspaceId, prompt, orchestrationId, stepId,
        createdAt: new Date().toISOString(),
        timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
        status: 'pending',
      }),
      'EX', redisTtlSec,
    ).catch((err: unknown) => logger.warn({ err, orchestrationId, stepId }, 'Failed to write gate to Redis — continuing'));
  });
}

/**
 * Resolves a pending gate request.
 * Returns true if the gate was found and resolved, false otherwise.
 * Prevents cross-workspace gate injection.
 *
 * Redis is updated fire-and-forget; failures never block or throw.
 */
export function resolveGate(
  orchestrationId: string,
  stepId: string,
  workspaceId: string,
  approved: boolean,
  callerId: string = 'unknown',
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

  // Update Redis status (fire-and-forget)
  mutateGateMetadata(redisGateKey(orchestrationId, stepId), (parsed) => ({
    ...parsed,
    status: approved ? 'approved' : 'rejected',
    decidedAt: new Date().toISOString(),
    decidedBy: callerId,
  })).catch((err: unknown) => logger.warn({ err }, 'Failed to update gate status in Redis'));

  // Persist audit record (fire-and-forget)
  gateAuditRepo.insert({
    orchestrationId,
    stepId,
    workspaceId: pending.workspaceId,
    outcome: approved ? 'approved' : 'rejected',
    decidedBy: callerId,
    prompt: pending.prompt,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write gate audit record'));

  // Emit real-time event (fire-and-forget — emitGateResolved catches its own errors)
  emitGateResolved(orchestrationId, stepId, approved ? 'approved' : 'rejected', pending.workspaceId);

  return true;
}

/** Returns the number of currently pending gates (for observability). */
export function pendingGateCount(): number {
  return pendingGates.size;
}

/**
 * Called at startup to mark any gates that were 'pending' before restart as 'timeout'.
 * The in-memory Promise is gone after restart so those orchestrations will naturally time out.
 * Errors are swallowed so startup is never blocked.
 */
export async function recoverPendingGates(): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis().scan(cursor, 'MATCH', 'gate:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const raw = await redis().get(key).catch(() => null);
      const parsed = parseGateRaw(raw);
      if (!parsed || parsed.status !== 'pending') continue;
      logger.warn({ ...parsed }, 'Gate was pending at restart — marking timeout');
      await redis().set(
        key,
        JSON.stringify({ ...parsed, status: 'timeout', decidedAt: new Date().toISOString(), decidedBy: 'system' }),
        'KEEPTTL',
      ).catch(() => {});

      // Persist audit record (fire-and-forget)
      const recOrchId = typeof parsed.orchestrationId === 'string' ? parsed.orchestrationId : undefined;
      const recStepId = typeof parsed.stepId === 'string' ? parsed.stepId : undefined;
      const recWsId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined;
      if (!recOrchId || !recStepId || !recWsId) continue;
      gateAuditRepo.insert({
        orchestrationId: recOrchId,
        stepId: recStepId,
        workspaceId: recWsId,
        outcome: 'timeout',
        decidedBy: 'system',
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
      }).catch(() => {});

      // Emit real-time event (fire-and-forget — emitGateResolved catches its own errors)
      emitGateResolved(recOrchId, recStepId, 'timeout', recWsId);
    }
  } while (cursor !== '0');
}

/**
 * Lists all gates that are currently 'pending' in Redis.
 * Optionally filtered by workspaceId.
 */
export async function listPendingGates(workspaceId?: string): Promise<GateMetadata[]> {
  const results: GateMetadata[] = [];
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis().scan(cursor, 'MATCH', 'gate:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const raw = await redis().get(key).catch(() => null);
      const parsed = parseGateRaw(raw) as GateMetadata | null;
      if (!parsed || parsed.status !== 'pending') continue;
      if (workspaceId && parsed.workspaceId !== workspaceId) continue;
      results.push(parsed);
    }
  } while (cursor !== '0');
  return results;
}
