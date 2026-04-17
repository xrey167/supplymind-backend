import { selectPriority, selectRoundRobin, selectWeighted, selectCostOptimized } from './strategies';
import type { RoutingConfig, RoutedTarget } from './types';

export class StrategyRouter {
  private config: RoutingConfig;
  private counter: number;

  constructor(config: RoutingConfig) {
    this.config = config;
    this.counter = config.roundRobinCounter;
  }

  select(excluded: Set<string> = new Set()): RoutedTarget {
    const { strategy, providers } = this.config;
    let target: RoutedTarget | null = null;

    switch (strategy) {
      case 'priority':
        target = selectPriority(providers, excluded);
        break;
      case 'round-robin':
        target = selectRoundRobin(providers, this.counter++, excluded);
        break;
      case 'weighted':
        target = selectWeighted(providers, excluded);
        break;
      case 'cost-optimized':
        target = selectCostOptimized(providers, excluded);
        break;
    }

    if (!target) throw new Error('No available provider after exclusions');
    return target;
  }

  /** Current counter value — persist this after a round-robin call. */
  get currentCounter(): number {
    return this.counter;
  }
}
