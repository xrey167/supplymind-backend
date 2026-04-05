import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'operator', 'agent', 'viewer']).optional().default('operator'),
  expiresAt: z.coerce.date().optional(),
});

export const apiKeyParamSchema = z.object({
  keyId: z.string().uuid(),
});

export const apiKeyResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  enabled: z.boolean(),
  keyPrefix: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const createApiKeyResponseSchema = z.object({
  token: z.string(),
  key: apiKeyResponseSchema,
});
