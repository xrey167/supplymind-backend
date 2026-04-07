import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { notificationsService } from './notifications.service';
import {
  listNotificationsQuery,
  markReadParam,
  updatePreferencesBody,
} from './notifications.schemas';
import { notificationPreferencesRepo } from './preferences/notification-preferences.repo';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: listNotificationsQuery },
  responses: { 200: { description: 'List notifications', ...jsonRes } },
});

const markReadRoute = createRoute({
  method: 'post',
  path: '/{id}/read',
  request: { params: markReadParam },
  responses: { 200: { description: 'Notification marked read', ...jsonRes } },
});

const markAllReadRoute = createRoute({
  method: 'post',
  path: '/read-all',
  responses: { 200: { description: 'All notifications marked read', ...jsonRes } },
});

const unreadCountRoute = createRoute({
  method: 'get',
  path: '/unread-count',
  responses: { 200: { description: 'Unread notification count', ...jsonRes } },
});

const listPreferencesRoute = createRoute({
  method: 'get',
  path: '/preferences',
  responses: { 200: { description: 'List notification preferences', ...jsonRes } },
});

const updatePreferencesRoute = createRoute({
  method: 'put',
  path: '/preferences',
  request: { body: { content: { 'application/json': { schema: updatePreferencesBody } } } },
  responses: { 200: { description: 'Preferences updated', ...jsonRes } },
});

export const NotificationsRoutes = new OpenAPIHono();

NotificationsRoutes.openapi(listRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  const query = c.req.valid('query');
  const items = await notificationsService.list(userId, workspaceId, {
    unreadOnly: query.unreadOnly,
    type: query.type as any,
    limit: query.limit,
    offset: query.offset,
  });
  return c.json({ data: items });
});

NotificationsRoutes.openapi(markReadRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await notificationsService.markRead(id);
  return c.json({ data: result });
});

NotificationsRoutes.openapi(markAllReadRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  await notificationsService.markAllRead(userId, workspaceId);
  return c.json({ success: true });
});

NotificationsRoutes.openapi(unreadCountRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  const count = await notificationsService.getUnreadCount(userId, workspaceId);
  return c.json({ data: { count } });
});

NotificationsRoutes.openapi(listPreferencesRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  const prefs = await notificationPreferencesRepo.list(userId, workspaceId);
  return c.json({ data: prefs });
});

NotificationsRoutes.openapi(updatePreferencesRoute, async (c) => {
  const userId = c.get('callerId') as string;
  const workspaceId = c.get('workspaceId') as string;
  const body = c.req.valid('json');
  const result = await notificationPreferencesRepo.upsert({
    userId,
    workspaceId,
    type: body.type,
    channels: body.channels,
    muted: body.muted,
  });
  return c.json({ data: result });
});
