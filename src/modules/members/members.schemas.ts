import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const updateRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

export const memberUserIdParamSchema = z.object({
  userId: z.string().min(1),
});

export const invitationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const invitationTokenParamSchema = z.object({
  token: z.string().min(1),
});
