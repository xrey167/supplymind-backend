/**
 * Trust Tier Service
 *
 * Reads the workspace's learning.trust_tier setting and returns a
 * TrustTierConfig that controls what the learning engine can auto-apply
 * vs. must queue for human approval.
 *
 * Default tier: 'observer' (propose only, nothing auto-applies).
 */

import type { TrustTier } from '../settings/workspace-settings/workspace-settings.schemas';
import { WorkspaceSettingKeys } from '../settings/workspace-settings/workspace-settings.schemas';

export interface TrustTierConfig {
  tier: TrustTier;
  autoApply: {
    skillWeights: boolean;
    memoryThresholds: boolean;
    modelRouting: boolean;
    promptOptimization: boolean;
    newSkills: boolean;
    workflowGeneration: boolean;
  };
  guards: {
    maxDailyAutoChanges: number;
    maxCostBudgetUSD: number;
  };
}

const TIER_CONFIGS: Record<TrustTier, TrustTierConfig> = {
  observer: {
    tier: 'observer',
    autoApply: {
      skillWeights: false,
      memoryThresholds: false,
      modelRouting: false,
      promptOptimization: false,
      newSkills: false,
      workflowGeneration: false,
    },
    guards: { maxDailyAutoChanges: 0, maxCostBudgetUSD: 0 },
  },
  learner: {
    tier: 'learner',
    autoApply: {
      skillWeights: true,
      memoryThresholds: true,
      modelRouting: false,
      promptOptimization: false,
      newSkills: false,
      workflowGeneration: false,
    },
    guards: { maxDailyAutoChanges: 10, maxCostBudgetUSD: 5 },
  },
  autonomous: {
    tier: 'autonomous',
    autoApply: {
      skillWeights: true,
      memoryThresholds: true,
      modelRouting: true,
      promptOptimization: true,
      newSkills: true,
      workflowGeneration: false,
    },
    guards: { maxDailyAutoChanges: 50, maxCostBudgetUSD: 25 },
  },
  trusted: {
    tier: 'trusted',
    autoApply: {
      skillWeights: true,
      memoryThresholds: true,
      modelRouting: true,
      promptOptimization: true,
      newSkills: true,
      workflowGeneration: true,
    },
    guards: { maxDailyAutoChanges: 200, maxCostBudgetUSD: 100 },
  },
};

const CHANGE_TYPE_TO_CONFIG_KEY: Record<string, keyof TrustTierConfig['autoApply']> = {
  skill_weight: 'skillWeights',
  memory_threshold: 'memoryThresholds',
  routing_rule: 'modelRouting',
  prompt_update: 'promptOptimization',
  new_skill: 'newSkills',
  workflow_template: 'workflowGeneration',
};

export class TrustTierService {
  async getTierConfig(workspaceId: string): Promise<TrustTierConfig> {
    try {
      const { workspaceSettingsService } = await import('../settings/workspace-settings/workspace-settings.service');
      const raw = await workspaceSettingsService.getRaw(workspaceId, WorkspaceSettingKeys.LEARNING_TRUST_TIER);
      const tier = (raw ?? 'observer') as TrustTier;
      return TIER_CONFIGS[tier] ?? TIER_CONFIGS.observer;
    } catch {
      return TIER_CONFIGS.observer;
    }
  }

  async canAutoApply(workspaceId: string, proposalType: string): Promise<boolean> {
    const config = await this.getTierConfig(workspaceId);
    const key = CHANGE_TYPE_TO_CONFIG_KEY[proposalType];
    if (!key) return false;
    return config.autoApply[key] ?? false;
  }

  async setTier(workspaceId: string, tier: TrustTier): Promise<void> {
    const { workspaceSettingsService } = await import('../settings/workspace-settings/workspace-settings.service');
    await workspaceSettingsService.set(workspaceId, WorkspaceSettingKeys.LEARNING_TRUST_TIER, tier);
  }
}

export const trustTierService = new TrustTierService();
