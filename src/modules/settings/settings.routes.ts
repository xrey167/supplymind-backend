import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { userSettingsService } from './user-settings/user-settings.service';
import { userSettingKeyParamSchema, setUserSettingBodySchema } from './settings.schemas';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const getAllRoute = createRoute({
  method: 'get',
  path: '/user',
  responses: { 200: { description: 'All user settings with defaults', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get',
  path: '/user/{key}',
  request: { params: userSettingKeyParamSchema },
  responses: { 200: { description: 'User setting value', ...jsonRes } },
});

const setRoute = createRoute({
  method: 'put',
  path: '/user/{key}',
  request: {
    params: userSettingKeyParamSchema,
    body: { content: { 'application/json': { schema: setUserSettingBodySchema } } },
  },
  responses: { 200: { description: 'Setting updated', ...jsonRes } },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/user/{key}',
  request: { params: userSettingKeyParamSchema },
  responses: { 200: { description: 'Setting deleted', ...jsonRes }, 404: errRes('Not found') },
});

export const settingsRoutes = new OpenAPIHono<AppEnv>();

settingsRoutes.openapi(getAllRoute, async (c) => {
  const userId = c.get('userId') as string;
  const settings = await userSettingsService.getAll(userId);
  return c.json({ data: settings });
});

settingsRoutes.openapi(getRoute, async (c) => {
  const userId = c.get('userId') as string;
  const { key } = c.req.valid('param');
  const value = await userSettingsService.get(userId, key);
  return c.json({ data: { key, value } });
});

settingsRoutes.openapi(setRoute, async (c) => {
  const userId = c.get('userId') as string;
  const { key } = c.req.valid('param');
  const { value } = c.req.valid('json');
  await userSettingsService.set(userId, key, value);
  eventBus.publish(Topics.SETTINGS_UPDATED, { userId, key, value });
  return c.json({ data: { key, value } });
});

settingsRoutes.openapi(deleteRoute, async (c) => {
  const userId = c.get('userId') as string;
  const { key } = c.req.valid('param');
  const deleted = await userSettingsService.delete(userId, key);
  if (!deleted) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Setting "${key}" not found` } }, 404);
  }
  eventBus.publish(Topics.SETTINGS_UPDATED, { userId, key, value: null });
  return c.json({ data: { key, deleted: true } });
});
