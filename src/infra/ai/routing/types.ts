import type { AIProvider, AgentMode } from '../types';

export type RoutingStrategy =
  | 'priority' | 'round-robin' | 'weighted' | 'cost-optimized'
  | 'random' | 'strict-random' | 'fill-first'
  | 'least-used'
  | 'p2c'
  | 'auto' | 'lkgp';

export interface ProviderEntry {
  provider: AIProvider;
  model: string;
  weight: number;           // 1–100, used by weighted strategy
  costPer1kTokens: number;  // USD, used by cost-optimized strategy
  mode?: AgentMode;         // defaults to 'raw'
  capacity?: number;        // max requests before fill-first overflows to next provider
  tier?: 'primary' | 'secondary' | 'fallback';
}

export interface RoutingConfig {
  id: string;
  workspaceId: string;
  strategy: RoutingStrategy;
  providers: ProviderEntry[];
  roundRobinCounter: number;   // persisted counter for round-robin continuity
  strictRandomDeck?: string[]; // persisted shuffled deck for strict-random continuity
  updatedAt: Date;
}

export interface RoutedTarget {
  provider: AIProvider;
  model: string;
  mode: AgentMode;
}
