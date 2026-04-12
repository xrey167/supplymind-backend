import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { inboxService } from './inbox.service';
import { listInboxQuerySchema, inboxIdParamSchema } from './inbox.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: listInboxQuerySchema },
  responses: { 200: { description: 'List inbox items', ...jsonRes } },
});

const markReadRoute = createRoute({
  method: 'post',
  path: '/{id}/read',
  request: { params: inboxIdParamSchema },
  responses: { 200: { description: 'Item marked read', ...jsonRes } },
});

const markAllReadRoute = createRoute({
  method: 'post',
  path: '/read-all',
  responses: { 200: { description: 'All items marked read', ...jsonRes } },
});

const togglePinRoute = createRoute({
  method: 'post',
  path: '/{id}/pin',
  request: { params: inboxIdParamSchema },
  responses: { 200: { description: 'Item pin toggled', ...jsonRes } },
});

const unreadCountRoute = createRoute({
  method: 'get',
  path: '/unread-count',
  responses: { 200: { description: 'Unread inbox count', ...jsonRes } },
});

export const InboxRoutes = new OpenAPIHono<AppEnv>();

InboxRoutes.openapi(listRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  const query = c.req.valid('query');
  const items = await inboxService.list(userId, workspaceId, {
    unreadOnly: query.unreadOnly,
    type: query.type as any,
    pinned: query.pinned,
    limit: query.limit,
    offset: query.offset,
  });
  return c.json({ data: items });
});

InboxRoutes.openapi(markReadRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await inboxService.markRead(id);
  return c.json({ data: result });
});

InboxRoutes.openapi(markAllReadRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  await inboxService.markAllRead(userId, workspaceId);
  return c.json({ success: true });
});

InboxRoutes.openapi(togglePinRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await inboxService.togglePin(id);
  return c.json({ data: result });
});

InboxRoutes.openapi(unreadCountRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  const count = await inboxService.getUnreadCount(userId, workspaceId);
  return c.json({ data: { count } });
});
