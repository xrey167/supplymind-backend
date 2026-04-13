import { z } from 'zod';

const AlertConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'gt', 'lt', 'contains', 'exists']),
  value: z.unknown().optional(),
});

export const CreateAlertRuleBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  eventTopic: z.string().min(1),
  conditions: z.array(AlertConditionSchema).default([]),
  notifyUserIds: z.array(z.string()).default([]),
  messageTemplate: z.string().optional(),
  cooldownSeconds: z.number().int().min(0).default(300),
});

export const UpdateAlertRuleBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  eventTopic: z.string().min(1).optional(),
  conditions: z.array(AlertConditionSchema).optional(),
  notifyUserIds: z.array(z.string()).optional(),
  messageTemplate: z.string().optional(),
  cooldownSeconds: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

export const AlertRuleParamsSchema = z.object({
  ruleId: z.string().uuid(),
});
