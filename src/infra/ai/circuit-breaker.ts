import { getSharedRedisClient } from '../redis/client';
import { getHealth, setCooldown, clearCooldown, recordSuccess, recordFailure } from './health-store';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Error rate (0–1) that triggers OPEN. Default: 0.5 */
  errorRateThreshold: number;
  /** Minimum calls before circuit can open. Default: 5 */
  minCallsBeforeOpen: number;
  /** Milliseconds to stay OPEN before allowing HALF_OPEN probe. Default: 60_000 */
  cooldownMs: number;
  /** Max requests allowed in HALF_OPEN before forcing back to OPEN/CLOSED. Default: 3 */
  halfOpenMaxRequests: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  errorRateThreshold: 0.5,
  minCallsBeforeOpen: 5,
  cooldownMs: 60_000,
  halfOpenMaxRequests: 3,
};

const circuitKey = (workspaceId: string, provider: string) =>
  `circuit:${workspaceId}:${provider}`;

/** Get the current circuit state for a provider. */
export async function getCircuitState(
  workspaceId: string,
  provider: string,
  config: Partial<CircuitBreakerConfig> = {},
): Promise<CircuitState> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const redis = getSharedRedisClient();
  const k = circuitKey(workspaceId, provider);

  const raw = await redis.hgetall(k);
  const state = raw?.state as CircuitState | undefined;
  const openedAt = raw?.openedAt ? parseInt(raw.openedAt, 10) : null;

  if (!state || state === 'closed') return 'closed';

  if (state === 'open') {
    if (openedAt && Date.now() - openedAt >= cfg.cooldownMs) {
      // Transition to HALF_OPEN
      await redis.hset(k, 'state', 'half_open', 'halfOpenAttempts', '0');
      await redis.expire(k, 600);
      return 'half_open';
    }
    return 'open';
  }

  return 'half_open';
}

/** Open the circuit for a provider. */
export async function openCircuit(
  workspaceId: string,
  provider: string,
  config: Partial<CircuitBreakerConfig> = {},
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const redis = getSharedRedisClient();
  const k = circuitKey(workspaceId, provider);
  const now = Date.now();
  await redis.hmset(k, { state: 'open', openedAt: String(now), halfOpenAttempts: '0' });
  await redis.expire(k, Math.ceil(cfg.cooldownMs / 1000) + 120);
  await setCooldown(workspaceId, provider, now + cfg.cooldownMs);
}

/** Close the circuit (provider healthy again). */
export async function closeCircuit(workspaceId: string, provider: string): Promise<void> {
  const redis = getSharedRedisClient();
  await redis.hset(circuitKey(workspaceId, provider), 'state', 'closed');
  await clearCooldown(workspaceId, provider);
}

/**
 * Check health metrics and open the circuit if thresholds are exceeded.
 * Call this after every failed request.
 */
export async function evaluateCircuit(
  workspaceId: string,
  provider: string,
  config: Partial<CircuitBreakerConfig> = {},
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const health = await getHealth(workspaceId, provider);

  if (health.totalCalls >= cfg.minCallsBeforeOpen && health.errorRate >= cfg.errorRateThreshold) {
    await openCircuit(workspaceId, provider, cfg);
  }
}

/**
 * Record a successful request and close HALF_OPEN circuit if enough successes.
 */
export async function onSuccess(
  workspaceId: string,
  provider: string,
  latencyMs: number,
  config: Partial<CircuitBreakerConfig> = {},
): Promise<void> {
  await recordSuccess(workspaceId, provider, latencyMs);

  const state = await getCircuitState(workspaceId, provider, config);
  if (state === 'half_open') {
    await closeCircuit(workspaceId, provider);
  }
}

/**
 * Record a failed request and potentially open the circuit.
 */
export async function onFailure(
  workspaceId: string,
  provider: string,
  config: Partial<CircuitBreakerConfig> = {},
): Promise<void> {
  await recordFailure(workspaceId, provider);
  await evaluateCircuit(workspaceId, provider, config);
}

/**
 * Returns providers that should be excluded due to OPEN circuit state.
 */
export async function getOpenProviders(
  workspaceId: string,
  providerKeys: string[],
  config: Partial<CircuitBreakerConfig> = {},
): Promise<Set<string>> {
  const states = await Promise.all(
    providerKeys.map(async (p) => ({
      provider: p,
      state: await getCircuitState(workspaceId, p, config),
    })),
  );
  return new Set(
    states.filter((s) => s.state === 'open').map((s) => s.provider),
  );
}
