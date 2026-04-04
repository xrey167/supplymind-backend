import { z } from 'zod';

export const createToolSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  workspaceId: z.string().uuid().nullable().optional(),
  providerType: z.enum(['builtin', 'worker', 'plugin', 'mcp', 'inline']),
  priority: z.number().int().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  handlerConfig: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const updateToolSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  providerType: z.enum(['builtin', 'worker', 'plugin', 'mcp', 'inline']).optional(),
  priority: z.number().int().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  handlerConfig: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const toolIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listToolsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
});
