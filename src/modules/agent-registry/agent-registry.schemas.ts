import { z } from 'zod';

export const registerAgentSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().optional(),
});

export const agentRegistryIdParamSchema = z.object({
  agentId: z.string().uuid(),
});
