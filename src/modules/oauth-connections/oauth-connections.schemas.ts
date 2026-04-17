import { z } from 'zod';

export const exchangeCodeSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
  codeVerifier: z.string().min(1),
  state: z.string().optional(),
  email: z.string().email().optional(),
});

export const pollTokenSchema = z.object({
  deviceCode: z.string().min(1),
  /** Provider-specific data needed for polling (e.g. Kiro clientId/clientSecret). */
  extraData: z.record(z.string(), z.unknown()).optional(),
});

export const importTokenSchema = z.object({
  accessToken: z.string().min(1),
});
