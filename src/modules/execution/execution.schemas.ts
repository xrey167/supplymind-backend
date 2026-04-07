import { z } from 'zod';

const stepSchema = z.object({
  id: z.string(),
  type: z.enum(['skill', 'agent', 'collaboration', 'gate', 'decision']),
  skillId: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  agentId: z.string().optional(),
  message: z.string().optional(),
  strategy: z.enum(['fan_out', 'consensus', 'debate', 'map_reduce']).optional(),
  agentIds: z.array(z.string()).optional(),
  gatePrompt: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  onError: z.enum(['fail', 'skip', 'retry']).optional(),
  maxRetries: z.number().optional(),
  when: z.string().optional(),
  label: z.string().optional(),
  riskClass: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  approvalMode: z.enum(['auto', 'ask', 'required']).optional(),
  pluginId: z.string().uuid().optional(),
  capabilityId: z.string().optional(),
});

export const createPlanSchema = z.object({
  name: z.string().optional(),
  steps: z.array(stepSchema).min(1),
  input: z.record(z.string(), z.unknown()).optional(),
  policy: z.object({
    maxRetries: z.number().optional(),
    timeoutMs: z.number().optional(),
    budgetUsd: z.number().optional(),
    approvalMode: z.enum(['auto', 'ask', 'required']).optional(),
  }).optional(),
});

export const planIdParamSchema = z.object({ id: z.string().uuid() });
