import { getRoutingStrategy } from './strategy-registry';
import type { StrategyContext } from './strategy-registry';
import type { RoutingConfig, RoutedTarget } from './types';

export class StrategyRouter {
  private config: RoutingConfig;
  private counter: number;
  private deck: string[];

  constructor(config: RoutingConfig) {
    this.config = config;
    this.counter = config.roundRobinCounter;
    this.deck = config.strictRandomDeck ? [...config.strictRandomDeck] : [];
  }

  async select(
    excluded: Set<string> = new Set(),
    ctxExtra?: Partial<Pick<StrategyContext, 'usageCounts' | 'health' | 'lastKnownGood'>>,
  ): Promise<RoutedTarget> {
    const { strategy, providers, workspaceId } = this.config;
    const fn = getRoutingStrategy(strategy);

    const ctx: StrategyContext = {
      excluded,
      counter: this.counter++,
      workspaceId,
      strictRandomDeck: this.deck,
      usageCounts: ctxExtra?.usageCounts ?? new Map(),
      health: ctxExtra?.health,
      lastKnownGood: ctxExtra?.lastKnownGood,
    };

    const target = await fn(providers, ctx);
    if (!target) throw new Error('No available provider after exclusions');
    return target;
  }

  /** Current counter — persist this after a round-robin selection. */
  get currentCounter(): number {
    return this.counter;
  }

  /** Current deck state — persist this after a strict-random selection. */
  get currentDeck(): string[] {
    return [...this.deck];
  }
}
