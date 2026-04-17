import type { AIProvider, AgentMode } from '../types';

export type RoutingStrategy = 'priority' | 'round-robin' | 'weighted' | 'cost-optimized';

export interface ProviderEntry {
  provider: AIProvider;
  model: string;
  weight: number;           // 1–100, used by weighted strategy
  costPer1kTokens: number;  // USD, used by cost-optimized strategy
  mode?: AgentMode;         // defaults to 'raw'
}

export interface RoutingConfig {
  id: string;
  workspaceId: string;
  strategy: RoutingStrategy;
  providers: ProviderEntry[];
  roundRobinCounter: number; // persisted counter for round-robin continuity
  updatedAt: Date;
}

export interface RoutedTarget {
  provider: AIProvider;
  model: string;
  mode: AgentMode;
}
