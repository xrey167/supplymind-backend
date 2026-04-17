import { getSharedRedisClient } from '../redis/client';

export interface ProviderHealthMetrics {
  errorCount: number;
  successCount: number;
  totalCalls: number;
  errorRate: number;
  avgLatencyMs: number;
  lastSuccessAt: number | null;   // Unix ms
  lastFailureAt: number | null;   // Unix ms
  cooldownUntil: number | null;   // Unix ms — null means no cooldown
}

const HEALTH_TTL_SECONDS = 3600; // 1h rolling window

const hKey = (workspaceId: string, provider: string) =>
  `ai:health:${workspaceId}:${provider}`;

function parseMetrics(raw: Record<string, string> | null): ProviderHealthMetrics {
  if (!raw) {
    return {
      errorCount: 0, successCount: 0, totalCalls: 0,
      errorRate: 0, avgLatencyMs: 0,
      lastSuccessAt: null, lastFailureAt: null, cooldownUntil: null,
    };
  }

  const errorCount = parseInt(raw.errorCount ?? '0', 10);
  const successCount = parseInt(raw.successCount ?? '0', 10);
  const totalCalls = errorCount + successCount;

  return {
    errorCount,
    successCount,
    totalCalls,
    errorRate: totalCalls > 0 ? errorCount / totalCalls : 0,
    avgLatencyMs: parseFloat(raw.avgLatencyMs ?? '0'),
    lastSuccessAt: raw.lastSuccessAt ? parseInt(raw.lastSuccessAt, 10) : null,
    lastFailureAt: raw.lastFailureAt ? parseInt(raw.lastFailureAt, 10) : null,
    cooldownUntil: raw.cooldownUntil ? parseInt(raw.cooldownUntil, 10) : null,
  };
}

/**
 * Record a successful provider call.
 * Updates successCount and a rolling average of latency using an EMA (alpha=0.2).
 */
export async function recordSuccess(
  workspaceId: string,
  provider: string,
  latencyMs: number,
): Promise<void> {
  const redis = getSharedRedisClient();
  const k = hKey(workspaceId, provider);

  const raw = await redis.hgetall(k);
  const current = parseMetrics(raw && Object.keys(raw).length > 0 ? raw : null);

  const alpha = 0.2;
  const newAvg = current.totalCalls === 0
    ? latencyMs
    : (1 - alpha) * current.avgLatencyMs + alpha * latencyMs;

  await redis.hmset(k, {
    successCount: String(current.successCount + 1),
    errorCount: String(current.errorCount),
    avgLatencyMs: String(newAvg.toFixed(2)),
    lastSuccessAt: String(Date.now()),
  });
  await redis.expire(k, HEALTH_TTL_SECONDS);
}

/** Record a failed provider call. */
export async function recordFailure(workspaceId: string, provider: string): Promise<void> {
  const redis = getSharedRedisClient();
  const k = hKey(workspaceId, provider);

  const raw = await redis.hgetall(k);
  const current = parseMetrics(raw && Object.keys(raw).length > 0 ? raw : null);

  await redis.hmset(k, {
    successCount: String(current.successCount),
    errorCount: String(current.errorCount + 1),
    avgLatencyMs: String(current.avgLatencyMs),
    lastFailureAt: String(Date.now()),
  });
  await redis.expire(k, HEALTH_TTL_SECONDS);
}

/** Get health metrics for a single provider. */
export async function getHealth(
  workspaceId: string,
  provider: string,
): Promise<ProviderHealthMetrics> {
  const redis = getSharedRedisClient();
  const raw = await redis.hgetall(hKey(workspaceId, provider));
  return parseMetrics(raw && Object.keys(raw).length > 0 ? raw : null);
}

/** Get health metrics for multiple providers. Returns a Map keyed by provider string. */
export async function getAllHealth(
  workspaceId: string,
  providers: string[],
): Promise<Map<string, ProviderHealthMetrics>> {
  const entries = await Promise.all(
    providers.map(async (p) => [p, await getHealth(workspaceId, p)] as const),
  );
  return new Map(entries);
}

/** Put a provider into cooldown until the given Unix timestamp (ms). */
export async function setCooldown(
  workspaceId: string,
  provider: string,
  untilMs: number,
): Promise<void> {
  const redis = getSharedRedisClient();
  const k = hKey(workspaceId, provider);
  await redis.hset(k, 'cooldownUntil', String(untilMs));
  const ttlRemaining = Math.ceil((untilMs - Date.now()) / 1000) + 60;
  await redis.expire(k, Math.max(ttlRemaining, HEALTH_TTL_SECONDS));
}

/** Check if a provider is currently in cooldown. */
export async function isInCooldown(workspaceId: string, provider: string): Promise<boolean> {
  const redis = getSharedRedisClient();
  const val = await redis.hget(hKey(workspaceId, provider), 'cooldownUntil');
  if (!val) return false;
  return parseInt(val, 10) > Date.now();
}

/** Clear cooldown for a provider (used when circuit closes). */
export async function clearCooldown(workspaceId: string, provider: string): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.hdel(hKey(workspaceId, provider), 'cooldownUntil');
}
