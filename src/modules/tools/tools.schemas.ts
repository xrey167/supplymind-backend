import { z } from 'zod';

const jsonRecord = z.record(z.string(), z.unknown());

export const createToolSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  workspaceId: z.string().uuid().nullable().optional(),
  providerType: z.string().optional(),
  priority: z.number().int().optional(),
  inputSchema: jsonRecord.optional(),
  handlerConfig: jsonRecord.optional(),
  enabled: z.boolean().optional(),
});

export const updateToolSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  providerType: z.string().optional(),
  priority: z.number().int().optional(),
  inputSchema: jsonRecord.optional(),
  handlerConfig: jsonRecord.optional(),
  enabled: z.boolean().optional(),
});

export const toolIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listToolsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
});
