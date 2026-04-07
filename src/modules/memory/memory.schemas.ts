import { z } from 'zod';

export const saveMemorySchema = z.object({
  type: z.enum(['domain', 'feedback', 'pattern', 'reference']),
  title: z.string().min(1),
  content: z.string().min(1),
  agentId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const recallSchema = z.object({
  query: z.string().min(1),
  agentId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const memoryIdParamSchema = z.object({ id: z.string().uuid() });
export const proposalIdParamSchema = z.object({ id: z.string().uuid() });

export const memoryListQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
});

export const rejectProposalSchema = z.object({
  reason: z.string().optional(),
});

export const proposeMemorySchema = z.object({
  type: z.enum(['domain', 'feedback', 'pattern', 'reference']),
  title: z.string().min(1),
  content: z.string().min(1),
  evidence: z.string().optional(),
  agentId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
});
