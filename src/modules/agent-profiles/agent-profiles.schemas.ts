import { z } from 'zod';

const AGENT_CATEGORIES = ['executor', 'planner', 'researcher', 'reviewer', 'visual', 'ops', 'deep', 'quick'] as const;
const PERMISSION_MODES = ['auto', 'ask', 'strict'] as const;

export const createAgentProfileSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.enum(AGENT_CATEGORIES),
  provider: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional().default('ask'),
  isDefault: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateAgentProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  category: z.enum(AGENT_CATEGORIES).optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const agentProfileIdParamSchema = z.object({
  profileId: z.string().uuid(),
});

export const listAgentProfilesQuerySchema = z.object({
  category: z.enum(AGENT_CATEGORIES).optional(),
});
