import { getSharedRedisClient } from '../../infra/redis/client';

/** Redis key for the workspace's budget accumulator for a given YYYY-MM. */
function budgetKey(workspaceId: string, month: string): string {
  return `budget:${workspaceId}:${month}`;
}

/** Returns the current YYYY-MM string in UTC. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * 35-day TTL so the key auto-expires if monthly cleanup fails.
 * A calendar month is at most 31 days; 35 gives a comfortable buffer.
 */
const TTL_SECONDS = 35 * 24 * 60 * 60;

/**
 * Atomically add `costUsd` to the budget counter for the current month.
 * Returns the new total after the increment.
 */
export async function incrementBudgetCounter(workspaceId: string, costUsd: number): Promise<number> {
  const redis = getSharedRedisClient();
  const key = budgetKey(workspaceId, currentMonth());
  const pipeline = redis.pipeline();
  pipeline.incrbyfloat(key, costUsd);
  pipeline.expire(key, TTL_SECONDS);
  const results = await pipeline.exec();
  const raw = results?.[0]?.[1];
  return typeof raw === 'string' ? parseFloat(raw) : 0;
}

/**
 * Read the current budget counter for this workspace-month.
 * Returns 0 when the key does not exist (cold start or counter expired).
 */
export async function getBudgetCounter(workspaceId: string): Promise<number> {
  const redis = getSharedRedisClient();
  const raw = await redis.get(budgetKey(workspaceId, currentMonth()));
  if (!raw) return 0;
  return parseFloat(raw);
}

/**
 * Delete the budget counter key for a specific YYYY-MM.
 * Called by monthly cleanup to reset counters for the previous month.
 */
export async function resetBudgetCounter(workspaceId: string, month: string): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.del(budgetKey(workspaceId, month));
}

/**
 * Delete all budget counter keys for a given YYYY-MM across all workspaces.
 * Uses SCAN to avoid blocking the Redis event loop.
 * Safe to call even if no keys exist for that month.
 */
export async function resetAllBudgetCountersForMonth(month: string): Promise<number> {
  const redis = getSharedRedisClient();
  const pattern = `budget:*:${month}`;
  let cursor = '0';
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');

  return deleted;
}
