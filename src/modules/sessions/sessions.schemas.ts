import { z } from 'zod';

export const createSessionSchema = z.object({
  agentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const addMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolCalls: z.unknown().optional(),
});

export const transcriptQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50).optional(),
  cursor: z.string().optional(),
  includeCompacted: z.coerce.boolean().default(false).optional(),
});
