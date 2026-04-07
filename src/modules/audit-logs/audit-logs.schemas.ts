import { z } from 'zod';

const actorTypeEnum = z.enum(['user', 'agent', 'system', 'api_key']);
const auditActionEnum = z.enum([
  'create', 'update', 'delete', 'login', 'logout',
  'invite', 'settings_change', 'credential_access', 'plan_change',
]);
const resourceTypeEnum = z.enum([
  'agent', 'credential', 'workspace', 'member',
  'settings', 'subscription', 'task', 'skill',
]);

export const createAuditLogSchema = z.object({
  workspaceId: z.string().uuid(),
  actorId: z.string().min(1),
  actorType: actorTypeEnum,
  action: auditActionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  ipAddress: z.string().optional(),
});

export const listAuditLogsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
