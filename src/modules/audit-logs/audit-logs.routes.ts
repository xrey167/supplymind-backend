import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { auditLogsService } from './audit-logs.service';
import { listAuditLogsQuerySchema } from './audit-logs.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

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

export const AuditLogsRoutes = new OpenAPIHono();

AuditLogsRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const items = await auditLogsService.list({
    workspaceId: query.workspaceId,
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
  const count = await auditLogsService.count({
    workspaceId: query.workspaceId,
    actorId: query.actorId,
    action: query.action as any,
    resourceType: query.resourceType as any,
    resourceId: query.resourceId,
    since: query.since,
    until: query.until,
  });
  return c.json({ count });
});
