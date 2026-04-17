export type PolicyType = 'access' | 'budget' | 'routing';

export interface PolicyConditions {
  model_pattern?: string; // glob, e.g. "gpt-*"
  provider?: string;      // exact match, e.g. "openai"
}

export interface PolicyActions {
  block?: boolean;
  max_monthly_tokens?: number;
  max_daily_tokens?: number;
  prefer_providers?: string[];
}

export interface Policy {
  id: string;
  workspaceId: string;
  name: string;
  type: PolicyType;
  enabled: boolean;
  priority: number;         // lower = evaluated first
  conditions: PolicyConditions;
  actions: PolicyActions;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyContext {
  workspaceId: string;
  model: string;
  provider: string;
  tokensEstimated: number;
  monthlyTokensUsed: number;
  dailyTokensUsed: number;
}

export interface PolicyVerdict {
  allowed: boolean;
  reason: string | null;
  policyPhase: 'access' | 'budget' | 'routing' | 'passed';
  appliedPolicies: string[];
  adjustments: {
    preferredProviders: string[];
  };
}
