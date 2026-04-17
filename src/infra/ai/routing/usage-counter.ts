import { getSharedRedisClient } from '../../redis/client';

const USAGE_TTL_SECONDS = 86400; // 24h window

const key = (workspaceId: string) => `routing:usage:${workspaceId}`;
const quotaKey = (workspaceId: string, provider: string) => `routing:quota:${workspaceId}:${provider}`;

/** Increment the request count for a provider within a workspace. */
export async function incrementUsage(workspaceId: string, provider: string): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.hincrby(key(workspaceId), provider, 1);
  await redis.expire(key(workspaceId), USAGE_TTL_SECONDS);
}

/** Get request counts for all providers in a workspace. */
export async function getUsageCounts(workspaceId: string): Promise<Map<string, number>> {
  const redis = getSharedRedisClient();
  const raw = await redis.hgetall(key(workspaceId));
  const map = new Map<string, number>();
  for (const [k, v] of Object.entries(raw ?? {})) {
    map.set(k, parseInt(v, 10));
  }
  return map;
}

/** Reset usage counts for a specific provider. */
export async function resetUsage(workspaceId: string, provider: string): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.hdel(key(workspaceId), provider);
}

/**
 * Increment a quota counter for a provider (separate from general usage).
 * The counter auto-expires after `windowSec` seconds if not already set.
 */
export async function incrementQuota(
  workspaceId: string,
  provider: string,
  windowSec: number,
): Promise<number> {
  const redis = getSharedRedisClient();
  const k = quotaKey(workspaceId, provider);
  const count = await redis.incr(k);
  if (count === 1) {
    await redis.expire(k, windowSec);
  }
  return count;
}

/** Get current quota usage for a provider. Returns 0 if expired or not set. */
export async function getQuotaUsed(workspaceId: string, provider: string): Promise<number> {
  const redis = getSharedRedisClient();
  const val = await redis.get(quotaKey(workspaceId, provider));
  return val ? parseInt(val, 10) : 0;
}

/** Reset quota counter for a provider. */
export async function resetQuota(workspaceId: string, provider: string): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.del(quotaKey(workspaceId, provider));
}

// ── Last Known Good Provider (LKGP) ───────────────────────────────────────────

const LKGP_TTL_SECONDS = 86400; // 24h

/** Record the last successfully used provider for a workspace. */
export async function setLastKnownGood(workspaceId: string, provider: string): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.set(`routing:lkgp:${workspaceId}`, provider, 'EX', LKGP_TTL_SECONDS);
}

/** Get the last known good provider for a workspace. Returns null if not set. */
export async function getLastKnownGood(workspaceId: string): Promise<string | null> {
  const redis = getSharedRedisClient();
  return redis.get(`routing:lkgp:${workspaceId}`);
}
