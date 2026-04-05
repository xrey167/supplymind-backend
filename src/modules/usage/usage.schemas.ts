import { z } from 'zod';

export const usagePeriodSchema = z.enum(['day', 'week', 'month', 'all']).default('month');

export const usageQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month', 'all']).optional().default('month'),
});

export const usageSummaryResponseSchema = z.object({
  totalCostUsd: z.number(),
  totalTokens: z.object({ input: z.number(), output: z.number() }),
  byModel: z.array(z.object({
    model: z.string(),
    provider: z.string(),
    calls: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
  })),
  byAgent: z.array(z.object({
    agentId: z.string().nullable(),
    calls: z.number(),
    costUsd: z.number(),
  })),
  records: z.array(z.object({
    id: z.string(),
    model: z.string(),
    provider: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
    createdAt: z.string(),
    taskId: z.string().nullable(),
    agentId: z.string().nullable(),
  })),
});
