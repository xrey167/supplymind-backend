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
});
