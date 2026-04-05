import { z } from 'zod';

const workflowStepSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  args: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  onError: z.enum(['fail', 'skip', 'retry']).optional(),
  maxRetries: z.number().int().min(1).max(5).optional(),
  when: z.string().optional(),
  label: z.string().optional(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  steps: z.array(workflowStepSchema).min(1),
  maxConcurrency: z.number().int().min(1).max(50).optional(),
});

export const createWorkflowTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  definition: workflowDefinitionSchema,
});

export const updateWorkflowTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  definition: workflowDefinitionSchema.optional(),
});

export const workflowTemplateIdParamSchema = z.object({ id: z.string().uuid() });

export const runWorkflowTemplateSchema = z.object({
  sessionId: z.string().uuid().optional(),
  input: z.record(z.unknown()).optional(),
});
