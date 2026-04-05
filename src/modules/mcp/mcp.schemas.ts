import { z } from 'zod';

export const createMcpSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse', 'streamable-http']),
  url: z.string().url().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
});

export const updateMcpSchema = createMcpSchema.partial();

export const mcpIdParamSchema = z.object({ mcpId: z.string().uuid() });

export type CreateMcpInput = z.infer<typeof createMcpSchema>;
export type UpdateMcpInput = z.infer<typeof updateMcpSchema>;
