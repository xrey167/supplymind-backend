import type { ProviderEntry, RoutedTarget } from './types';
import type { AIProvider, AgentMode } from '../types';

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
