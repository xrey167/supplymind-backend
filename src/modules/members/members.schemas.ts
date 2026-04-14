import { z } from 'zod';

const INVITABLE_WORKSPACE_ROLES = [
  'admin',
  'member',
  'viewer',
  'procurement_manager',
  'logistics_coordinator',
  'warehouse_operator',
  'finance_approver',
] as const;

const ASSIGNABLE_WORKSPACE_ROLES = [
  'owner',
  ...INVITABLE_WORKSPACE_ROLES,
] as const;

export const createInvitationSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(INVITABLE_WORKSPACE_ROLES).default('member'),
});

export const updateRoleSchema = z.object({
  role: z.enum(ASSIGNABLE_WORKSPACE_ROLES),
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
