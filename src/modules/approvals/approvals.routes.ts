import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { approvalsService } from './approvals.service';
import { listApprovalsQuerySchema, approvalIdParamSchema, approvalActionSchema } from './approvals.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: listApprovalsQuerySchema },
  responses: { 200: { description: 'List pending approvals', ...jsonRes } },
});

const actRoute = createRoute({
  method: 'post',
  path: '/{kind}/{id}',
  request: {
    params: approvalIdParamSchema,
    body: { content: { 'application/json': { schema: approvalActionSchema } } },
  },
  responses: {
    200: { description: 'Action applied', ...jsonRes },
    400: { description: 'Invalid action', ...jsonRes },
    404: { description: 'Not found', ...jsonRes },
  },
});

export const approvalsRoutes = new OpenAPIHono();

approvalsRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const query = c.req.valid('query');
  const items = await approvalsService.list(workspaceId, {
    status: query.status,
    kind: query.kind,
  });
  return c.json(items);
});

approvalsRoutes.openapi(actRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const userId = c.get('userId') as string;
  const { kind, id } = c.req.valid('param');
  const { action, reason } = c.req.valid('json');
  try {
    const result = await approvalsService.act(workspaceId, kind, id, action, userId, reason);
    if (!result.ok) return c.json({ error: result.detail }, 400);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 400);
  }
});
