import { z } from 'zod';

export const createAgentSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  provider: z.enum(['anthropic', 'openai', 'google']),
  mode: z.enum(['raw', 'agent-sdk']),
  model: z.string().min(1),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  toolIds: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  provider: z.enum(['anthropic', 'openai', 'google']).optional(),
  mode: z.enum(['raw', 'agent-sdk']).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  toolIds: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const agentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listAgentsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});
