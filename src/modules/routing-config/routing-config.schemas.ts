import { z } from 'zod';

const providerEntrySchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  model: z.string().min(1),
  weight: z.number().int().min(1).max(100).default(50),
  costPer1kTokens: z.number().positive().default(0.003),
  mode: z.enum(['raw', 'agent-sdk']).optional(),
});

export const upsertRoutingConfigSchema = z.object({
  strategy: z.enum(['priority', 'round-robin', 'weighted', 'cost-optimized']),
  providers: z.array(providerEntrySchema).min(1).max(10),
});

export type UpsertRoutingConfigInput = z.infer<typeof upsertRoutingConfigSchema>;
