import { z } from 'zod';

export const proposalIdParamSchema = z.object({
  proposalId: z.string().uuid(),
});

export const listProposalsQuerySchema = z.object({
  status: z.enum(['pending', 'auto_applied', 'approved', 'rejected', 'rolled_back']).optional(),
  proposalType: z.enum(['skill_weight', 'routing_rule', 'memory_threshold', 'new_skill', 'prompt_update', 'workflow_template']).optional(),
  since: z.string().datetime().optional(),
});

export const proposalResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  pluginId: z.string().nullable(),
  proposalType: z.string(),
  changeType: z.string(),
  description: z.string(),
  evidence: z.unknown(),
  beforeValue: z.unknown(),
  afterValue: z.unknown(),
  confidence: z.number(),
  status: z.string(),
  rollbackData: z.unknown(),
  autoAppliedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const trustTierResponseSchema = z.object({
  tier: z.enum(['observer', 'learner', 'autonomous', 'trusted']),
  autoApply: z.object({
    skillWeights: z.boolean(),
    memoryThresholds: z.boolean(),
    modelRouting: z.boolean(),
    promptOptimization: z.boolean(),
    newSkills: z.boolean(),
    workflowGeneration: z.boolean(),
  }),
  guards: z.object({
    maxDailyAutoChanges: z.number(),
    maxCostBudgetUSD: z.number(),
  }),
});

export const updateTrustTierBodySchema = z.object({
  tier: z.enum(['observer', 'learner', 'autonomous', 'trusted']),
});
