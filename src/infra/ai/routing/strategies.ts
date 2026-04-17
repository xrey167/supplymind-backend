import type { ProviderEntry, RoutedTarget } from './types';
import type { AIProvider, AgentMode } from '../types';
import type { ProviderHealthMetrics } from '../health-store';
import { strategyRegistry } from './strategy-registry';

function toTarget(entry: ProviderEntry): RoutedTarget {
  return { provider: entry.provider as AIProvider, model: entry.model, mode: (entry.mode ?? 'raw') as AgentMode };
}

function available(providers: ProviderEntry[], excluded: Set<string>): ProviderEntry[] {
  return providers.filter((p) => !excluded.has(p.provider));
}

/** Returns the highest-priority (first) non-excluded provider. */
export function selectPriority(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  return pool[0] ? toTarget(pool[0]) : null;
}

/** Round-robin by a caller-supplied counter (caller must persist/increment it). */
export function selectRoundRobin(
  providers: ProviderEntry[],
  counter: number,
  excluded: Set<string> = new Set(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;
  return toTarget(pool[counter % pool.length]);
}

/** Weighted random selection proportional to each entry's `weight` field. */
export function selectWeighted(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;

  const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
  let random = Math.random() * totalWeight;

  for (const entry of pool) {
    random -= entry.weight;
    if (random <= 0) return toTarget(entry);
  }

  return toTarget(pool[pool.length - 1]);
}

/** Always picks the provider with the lowest `costPer1kTokens`. */
export function selectCostOptimized(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;
  const cheapest = pool.reduce((best, p) => (p.costPer1kTokens < best.costPer1kTokens ? p : best));
  return toTarget(cheapest);
}

/** Uniform random selection from the non-excluded pool. */
export function selectRandom(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;
  return toTarget(pool[Math.floor(Math.random() * pool.length)]);
}

/**
 * Strict-random: cycles through all providers in a shuffled deck before repeating.
 * Mutates `deckState` in-place (shifts consumed entry). Caller must persist updated deck.
 */
export function selectStrictRandom(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
  deckState: string[],
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;

  const availableKeys = pool.map((p) => p.provider);
  const filtered = deckState.filter((k) => (availableKeys as string[]).includes(k));

  if (filtered.length === 0) {
    // Fisher-Yates shuffle of fresh deck
    const deck = [...availableKeys];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    deckState.splice(0, deckState.length, ...deck);
  } else {
    deckState.splice(0, deckState.length, ...filtered);
  }

  const nextKey = deckState.shift()!;
  const entry = pool.find((p) => p.provider === nextKey) ?? pool[0];
  return toTarget(entry);
}

/**
 * Fill-first: saturate provider[0] up to its `capacity` before overflowing.
 * Providers without `capacity` are treated as infinite.
 */
export function selectFillFirst(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
  usageCounts: Map<string, number> = new Map(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;

  for (const entry of pool) {
    if (entry.capacity === undefined) return toTarget(entry);
    const used = usageCounts.get(entry.provider) ?? 0;
    if (used < entry.capacity) return toTarget(entry);
  }

  return toTarget(pool[pool.length - 1]);
}

/** Picks the provider with the fewest requests in the current usage window. */
export function selectLeastUsed(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
  usageCounts: Map<string, number> = new Map(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;
  const least = pool.reduce((best, p) =>
    (usageCounts.get(p.provider) ?? 0) < (usageCounts.get(best.provider) ?? 0) ? p : best,
  );
  return toTarget(least);
}

/**
 * Power of Two Choices: sample 2 random providers, pick the one with lower error rate.
 */
export function selectP2C(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
  health: Map<string, ProviderHealthMetrics> = new Map(),
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;
  if (pool.length === 1) return toTarget(pool[0]);

  const i = Math.floor(Math.random() * pool.length);
  let j = Math.floor(Math.random() * (pool.length - 1));
  if (j >= i) j++;

  const errorRate = (p: ProviderEntry) => health.get(p.provider)?.errorRate ?? 0;
  return toTarget(errorRate(pool[i]) <= errorRate(pool[j]) ? pool[i] : pool[j]);
}

/**
 * Last Known Good Provider: always route to the provider that last succeeded.
 * Falls back to priority order if no LKGP is recorded.
 */
export function selectLKGP(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
  lastKnownGood: string | null = null,
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;
  if (lastKnownGood) {
    const lkg = pool.find((p) => p.provider === lastKnownGood);
    if (lkg) return toTarget(lkg);
  }
  return toTarget(pool[0]);
}

interface IntelligentWeights {
  health: number;
  costInv: number;
  quota: number;
  latencyInv: number;
  stability: number;
  tierPriority: number;
}

const DEFAULT_WEIGHTS: IntelligentWeights = {
  health: 0.25,
  costInv: 0.20,
  quota: 0.20,
  latencyInv: 0.15,
  stability: 0.05,
  tierPriority: 0.05,
};

const TIER_SCORE: Record<string, number> = { primary: 1, secondary: 0.5, fallback: 0 };

/**
 * Auto: 6-factor weighted scoring selects the optimal provider.
 * Factors: health, costInv, quota utilisation, latency, stability, tier priority.
 */
export function selectAuto(
  providers: ProviderEntry[],
  excluded: Set<string> = new Set(),
  health: Map<string, ProviderHealthMetrics> = new Map(),
  usageCounts: Map<string, number> = new Map(),
  weights: Partial<IntelligentWeights> = {},
): RoutedTarget | null {
  const pool = available(providers, excluded);
  if (pool.length === 0) return null;
  if (pool.length === 1) return toTarget(pool[0]);

  const w = { ...DEFAULT_WEIGHTS, ...weights };

  // Normalise latency: find max to invert
  const maxLatency = Math.max(
    1,
    ...pool.map((p) => health.get(p.provider)?.avgLatencyMs ?? 0),
  );
  const maxCost = Math.max(1, ...pool.map((p) => p.costPer1kTokens));

  const scored = pool.map((p) => {
    const h = health.get(p.provider);
    const healthScore = 1 - (h?.errorRate ?? 0);
    const costInvScore = 1 - p.costPer1kTokens / maxCost;
    const usedCount = usageCounts.get(p.provider) ?? 0;
    const capacity = p.capacity ?? Infinity;
    const quotaScore = capacity === Infinity ? 1 : Math.max(0, 1 - usedCount / capacity);
    const latencyInvScore = 1 - (h?.avgLatencyMs ?? 0) / maxLatency;
    const lastSuccess = h?.lastSuccessAt ?? 0;
    const lastFailure = h?.lastFailureAt ?? 0;
    const stabilityScore = lastSuccess > lastFailure ? 1 : 0;
    const tierScore = TIER_SCORE[p.tier ?? 'primary'] ?? 1;

    const total =
      w.health * healthScore +
      w.costInv * costInvScore +
      w.quota * quotaScore +
      w.latencyInv * latencyInvScore +
      w.stability * stabilityScore +
      w.tierPriority * tierScore;

    return { entry: p, score: total };
  });

  scored.sort((a, b) => b.score - a.score);
  return toTarget(scored[0].entry);
}

// ── Register all built-in strategies ──────────────────────────────────────────

strategyRegistry.register('priority', (providers, ctx) =>
  selectPriority(providers, ctx.excluded),
);

strategyRegistry.register('round-robin', (providers, ctx) =>
  selectRoundRobin(providers, ctx.counter, ctx.excluded),
);

strategyRegistry.register('weighted', (providers, ctx) =>
  selectWeighted(providers, ctx.excluded),
);

strategyRegistry.register('cost-optimized', (providers, ctx) =>
  selectCostOptimized(providers, ctx.excluded),
);

strategyRegistry.register('random', (providers, ctx) =>
  selectRandom(providers, ctx.excluded),
);

strategyRegistry.register('strict-random', (providers, ctx) => {
  const deck = ctx.strictRandomDeck ?? [];
  return selectStrictRandom(providers, ctx.excluded, deck);
});

strategyRegistry.register('fill-first', (providers, ctx) =>
  selectFillFirst(providers, ctx.excluded, ctx.usageCounts),
);

strategyRegistry.register('least-used', (providers, ctx) =>
  selectLeastUsed(providers, ctx.excluded, ctx.usageCounts),
);

strategyRegistry.register('p2c', (providers, ctx) =>
  selectP2C(providers, ctx.excluded, ctx.health),
);

strategyRegistry.register('lkgp', (providers, ctx) =>
  selectLKGP(providers, ctx.excluded, ctx.lastKnownGood ?? null),
);

strategyRegistry.register('auto', (providers, ctx) =>
  selectAuto(providers, ctx.excluded, ctx.health, ctx.usageCounts),
);
