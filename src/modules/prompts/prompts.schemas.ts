import { z } from 'zod';

const promptVariableSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  default: z.string().optional(),
});

export const createPromptSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  content: z.string().min(1),
  variables: z.array(promptVariableSchema).optional(),
  tags: z.array(z.string()).optional(),
  createdBy: z.string().optional(),
});

export const updatePromptSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  content: z.string().min(1).optional(),
  variables: z.array(promptVariableSchema).optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const promptIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listPromptsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  tag: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const renderPromptSchema = z.object({
  variables: z.record(z.string(), z.string()),
});
