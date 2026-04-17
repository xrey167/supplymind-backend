import type { ProviderEntry, RoutedTarget } from './types';
import type { ProviderHealthMetrics } from '../health-store';

export interface StrategyContext {
  excluded: Set<string>;
  /** Monotonically incrementing counter — used by round-robin; caller persists it. */
  counter: number;
  /** Workspace ID — used by Redis-backed strategies. */
  workspaceId?: string;
  /** Current shuffled deck for strict-random — caller persists/updates after selection. */
  strictRandomDeck?: string[];
  /** Request counts per provider key — injected by caller for fill-first / least-used. */
  usageCounts?: Map<string, number>;
  /** Health metrics per provider — injected by caller for p2c / auto. */
  health?: Map<string, ProviderHealthMetrics>;
  /** Last known good provider key — injected by caller for lkgp. */
  lastKnownGood?: string | null;
}

export type StrategyFn = (
  providers: ProviderEntry[],
  ctx: StrategyContext,
) => RoutedTarget | null | Promise<RoutedTarget | null>;

class StrategyRegistry {
  private fns = new Map<string, StrategyFn>();

  register(name: string, fn: StrategyFn): void {
    this.fns.set(name, fn);
  }

  get(name: string): StrategyFn | undefined {
    return this.fns.get(name);
  }

  has(name: string): boolean {
    return this.fns.has(name);
  }
}

export const strategyRegistry = new StrategyRegistry();

export function getRoutingStrategy(name: string): StrategyFn {
  const fn = strategyRegistry.get(name);
  if (!fn) throw new Error(`Unknown routing strategy: ${name}`);
  return fn;
}
