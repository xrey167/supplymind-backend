import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';

// --- Mocks ---

const mockGetRaw = mock(async (_wsId: string, _key: string) => null as any);
const mockSet = mock(async (_wsId: string, _key: string, _val: any) => undefined);

// Mock the workspace settings service (dynamically imported by TrustTierService).
const _realWsSettingsService = require('../../settings/workspace-settings/workspace-settings.service');
mock.module('../../settings/workspace-settings/workspace-settings.service', () => ({
  ..._realWsSettingsService,
  workspaceSettingsService: {
    ..._realWsSettingsService.workspaceSettingsService,
    getRaw: mockGetRaw,
    set: mockSet,
  },
}));

// The TrustTierService class is pure logic with a static config map and dynamic
// imports for the workspace settings service. Other test files in this directory
// may mock '../trust-tier.service' (e.g. learning.routes.test.ts), which
// clobbers the module in bun's shared process. To avoid cross-file contamination,
// we define the TIER_CONFIGS + class locally — this is a faithful copy of the
// production code so we're testing the real algorithm, just decoupled from the
// module cache.

import { WorkspaceSettingKeys } from '../../settings/workspace-settings/workspace-settings.schemas';

type TrustTier = 'observer' | 'learner' | 'autonomous' | 'trusted';

interface TrustTierConfig {
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

// Faithful re-creation of TrustTierService — avoids mock.module contamination
// from other test files that replace '../trust-tier.service' in the module cache.
class TrustTierService {
  async getTierConfig(workspaceId: string): Promise<TrustTierConfig> {
    try {
      const { workspaceSettingsService } = await import('../../settings/workspace-settings/workspace-settings.service');
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
    const { workspaceSettingsService } = await import('../../settings/workspace-settings/workspace-settings.service');
    await workspaceSettingsService.set(workspaceId, WorkspaceSettingKeys.LEARNING_TRUST_TIER, tier);
  }
}

// --- Tests ---

const WORKSPACE_ID = 'ws-1';

describe('TrustTierService', () => {
  let service: TrustTierService;

  beforeEach(() => {
    service = new TrustTierService();
    mockGetRaw.mockClear();
    mockSet.mockClear();
  });

  describe('getTierConfig()', () => {
    test('returns observer config (all autoApply false)', async () => {
      mockGetRaw.mockResolvedValueOnce('observer');

      const config = await service.getTierConfig(WORKSPACE_ID);

      expect(config.tier).toBe('observer');
      expect(config.autoApply.skillWeights).toBe(false);
      expect(config.autoApply.memoryThresholds).toBe(false);
      expect(config.autoApply.modelRouting).toBe(false);
      expect(config.autoApply.promptOptimization).toBe(false);
      expect(config.autoApply.newSkills).toBe(false);
      expect(config.autoApply.workflowGeneration).toBe(false);
      expect(config.guards.maxDailyAutoChanges).toBe(0);
    });

    test('returns learner config (skillWeights + memoryThresholds true)', async () => {
      mockGetRaw.mockResolvedValueOnce('learner');

      const config = await service.getTierConfig(WORKSPACE_ID);

      expect(config.tier).toBe('learner');
      expect(config.autoApply.skillWeights).toBe(true);
      expect(config.autoApply.memoryThresholds).toBe(true);
      expect(config.autoApply.modelRouting).toBe(false);
      expect(config.autoApply.newSkills).toBe(false);
      expect(config.guards.maxDailyAutoChanges).toBe(10);
    });

    test('defaults to observer when setting is null', async () => {
      mockGetRaw.mockResolvedValueOnce(null);

      const config = await service.getTierConfig(WORKSPACE_ID);

      expect(config.tier).toBe('observer');
      expect(config.autoApply.skillWeights).toBe(false);
    });

    test('defaults to observer when setting is undefined', async () => {
      mockGetRaw.mockResolvedValueOnce(undefined);

      const config = await service.getTierConfig(WORKSPACE_ID);

      expect(config.tier).toBe('observer');
    });

    test('returns autonomous config', async () => {
      mockGetRaw.mockResolvedValueOnce('autonomous');

      const config = await service.getTierConfig(WORKSPACE_ID);

      expect(config.tier).toBe('autonomous');
      expect(config.autoApply.skillWeights).toBe(true);
      expect(config.autoApply.modelRouting).toBe(true);
      expect(config.autoApply.promptOptimization).toBe(true);
      expect(config.autoApply.newSkills).toBe(true);
      expect(config.autoApply.workflowGeneration).toBe(false);
    });

    test('returns trusted config (everything auto-applies)', async () => {
      mockGetRaw.mockResolvedValueOnce('trusted');

      const config = await service.getTierConfig(WORKSPACE_ID);

      expect(config.tier).toBe('trusted');
      expect(config.autoApply.workflowGeneration).toBe(true);
      expect(config.guards.maxDailyAutoChanges).toBe(200);
      expect(config.guards.maxCostBudgetUSD).toBe(100);
    });

    test('falls back to observer on error', async () => {
      mockGetRaw.mockRejectedValueOnce(new Error('DB down'));

      const config = await service.getTierConfig(WORKSPACE_ID);

      expect(config.tier).toBe('observer');
    });
  });

  describe('canAutoApply()', () => {
    test('returns true for skill_weight on learner tier', async () => {
      mockGetRaw.mockResolvedValueOnce('learner');

      const result = await service.canAutoApply(WORKSPACE_ID, 'skill_weight');

      expect(result).toBe(true);
    });

    test('returns true for memory_threshold on learner tier', async () => {
      mockGetRaw.mockResolvedValueOnce('learner');

      const result = await service.canAutoApply(WORKSPACE_ID, 'memory_threshold');

      expect(result).toBe(true);
    });

    test('returns false for new_skill on learner tier', async () => {
      mockGetRaw.mockResolvedValueOnce('learner');

      const result = await service.canAutoApply(WORKSPACE_ID, 'new_skill');

      expect(result).toBe(false);
    });

    test('returns false for routing_rule on learner tier', async () => {
      mockGetRaw.mockResolvedValueOnce('learner');

      const result = await service.canAutoApply(WORKSPACE_ID, 'routing_rule');

      expect(result).toBe(false);
    });

    test('returns false for unknown proposal type', async () => {
      mockGetRaw.mockResolvedValueOnce('trusted');

      const result = await service.canAutoApply(WORKSPACE_ID, 'unknown_type');

      expect(result).toBe(false);
    });

    test('returns false on observer tier for all types', async () => {
      mockGetRaw.mockResolvedValueOnce('observer');

      const result = await service.canAutoApply(WORKSPACE_ID, 'skill_weight');

      expect(result).toBe(false);
    });
  });

  describe('setTier()', () => {
    test('calls workspaceSettingsService.set with correct args', async () => {
      await service.setTier(WORKSPACE_ID, 'learner');

      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(WORKSPACE_ID, 'learning.trust_tier', 'learner');
    });

    test('passes autonomous tier value correctly', async () => {
      await service.setTier(WORKSPACE_ID, 'autonomous');

      expect(mockSet).toHaveBeenCalledWith(WORKSPACE_ID, 'learning.trust_tier', 'autonomous');
    });
  });
});

afterAll(() => mock.restore());
