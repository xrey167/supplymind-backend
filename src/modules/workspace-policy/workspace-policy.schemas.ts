import { z } from 'zod';

export const policyConditionsSchema = z.object({
  model_pattern: z.string().optional(),
  provider: z.string().optional(),
});

export const policyActionsSchema = z.object({
  block: z.boolean().optional(),
  max_monthly_tokens: z.number().int().positive().optional(),
  max_daily_tokens: z.number().int().positive().optional(),
  prefer_providers: z.array(z.string()).optional(),
});

export const createPolicySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['access', 'budget', 'routing']),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(1000).default(100),
  conditions: policyConditionsSchema.default({}),
  actions: policyActionsSchema,
});

export const updatePolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['access', 'budget', 'routing']).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  conditions: policyConditionsSchema.optional(),
  actions: policyActionsSchema.optional(),
});

export const policyParamSchema = z.object({
  policyId: z.string().uuid(),
});

export const policyResponseSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  type: z.enum(['access', 'budget', 'routing']),
  enabled: z.boolean(),
  priority: z.number(),
  conditions: policyConditionsSchema,
  actions: policyActionsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
