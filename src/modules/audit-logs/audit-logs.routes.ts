import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { auditLogsService } from './audit-logs.service';
import { listAuditLogsQuerySchema } from './audit-logs.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const statsRoute = createRoute({
  method: 'get',
  path: '/stats',
  responses: {
    200: { description: 'Audit log statistics', ...jsonRes },
    500: { description: 'Internal server error', ...jsonRes },
  },
});

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: listAuditLogsQuerySchema },
  responses: { 200: { description: 'List audit logs', ...jsonRes } },
});

const countRoute = createRoute({
  method: 'get',
  path: '/count',
  request: { query: listAuditLogsQuerySchema },
  responses: { 200: { description: 'Count audit logs', ...jsonRes } },
});

export const AuditLogsRoutes = new OpenAPIHono<AppEnv>();

AuditLogsRoutes.openapi(statsRoute, async (c) => {
  const workspaceId = c.get('workspaceId');
  const stats = await auditLogsService.stats(workspaceId);
  return c.json({ data: stats });
});

AuditLogsRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const workspaceId = c.get('workspaceId') || query.workspaceId!;
  const items = await auditLogsService.list({
    workspaceId,
    actorId: query.actorId,
    action: query.action as any,
    resourceType: query.resourceType as any,
    resourceId: query.resourceId,
    since: query.since,
    until: query.until,
    limit: query.limit,
    offset: query.offset,
  });
  return c.json({ data: items });
});

AuditLogsRoutes.openapi(countRoute, async (c) => {
  const query = c.req.valid('query');
  const workspaceId = c.get('workspaceId') || query.workspaceId!;
  const count = await auditLogsService.count({
    workspaceId,
    actorId: query.actorId,
    action: query.action as any,
    resourceType: query.resourceType as any,
    resourceId: query.resourceId,
    since: query.since,
    until: query.until,
  });
  return c.json({ data: { count } });
});
