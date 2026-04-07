import { z } from 'zod';

export const createCredentialSchema = z.object({
  name: z.string().min(1).max(255),
  provider: z.enum(['anthropic', 'openai', 'google', 'custom']),
  value: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateCredentialSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  value: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const credentialIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listCredentialsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
});
