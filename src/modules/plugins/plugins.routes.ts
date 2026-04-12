import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { pluginsService } from './plugins.service';
import { pluginHealthRepo } from './plugins.health.repo';
import { installPluginSchema, updateConfigSchema, pinVersionSchema, installationIdParamSchema } from './plugins.schemas';
import type { Actor } from './plugins.types';
import { PluginConflictError } from './plugins.types';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });
const idParam = { request: { params: installationIdParamSchema } };

const installRoute = createRoute({ method: 'post', path: '/install', request: { body: { content: { 'application/json': { schema: installPluginSchema } } } }, responses: { 201: { description: 'Installed', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const listRoute = createRoute({ method: 'get', path: '/', responses: { 200: { description: 'Installations', ...jsonRes } } });
const getRoute = createRoute({ method: 'get', path: '/{id}', ...idParam, responses: { 200: { description: 'Installation', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } } });
const configRoute = createRoute({ method: 'patch', path: '/{id}/config', request: { params: installationIdParamSchema, body: { content: { 'application/json': { schema: updateConfigSchema } } } }, responses: { 200: { description: 'Updated', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const enableRoute = createRoute({ method: 'post', path: '/{id}/enable', ...idParam, responses: { 200: { description: 'Enabled', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const disableRoute = createRoute({ method: 'post', path: '/{id}/disable', ...idParam, responses: { 200: { description: 'Disabled', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const pinRoute = createRoute({ method: 'post', path: '/{id}/pin', request: { params: installationIdParamSchema, body: { content: { 'application/json': { schema: pinVersionSchema } } } }, responses: { 200: { description: 'Pinned', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const uninstallRoute = createRoute({ method: 'post', path: '/{id}/uninstall', ...idParam, responses: { 204: { description: 'Uninstalled' }, 400: { description: 'Error', ...jsonRes } } });
const rollbackRoute = createRoute({ method: 'post', path: '/{id}/rollback', ...idParam, responses: { 200: { description: 'Rolled back', ...jsonRes }, 400: { description: 'Error', ...jsonRes }, 409: { description: 'No prior version', ...jsonRes } } });
const eventsRoute = createRoute({ method: 'get', path: '/{id}/events', ...idParam, responses: { 200: { description: 'Events', ...jsonRes }, 404: errRes('Not found') } });
const healthRoute = createRoute({ method: 'get', path: '/{id}/health', ...idParam, responses: { 200: { description: 'Health', ...jsonRes }, 404: errRes('Not found') } });
const healthRunRoute = createRoute({ method: 'post', path: '/{id}/health/run', ...idParam, responses: { 200: { description: 'Health checked', ...jsonRes }, 400: errRes('Bad request') } });

export const pluginRoutes = new OpenAPIHono<AppEnv>();

function getActor(c: any): Actor {
  const callerId = c.get('callerId') as string | undefined;
  if (!callerId) throw new Error('Authenticated user ID not found in request context');
  return { id: callerId, type: 'user' };
}

pluginRoutes.openapi(installRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { pluginId, config } = c.req.valid('json');
  const result = await pluginsService.install(workspaceId, pluginId, config, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value, 201);
});

pluginRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  return c.json({ data: await pluginsService.list(workspaceId) });
});

pluginRoutes.openapi(getRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const inst = await pluginsService.get(workspaceId, id);
  if (!inst) return c.json({ error: 'Not found' }, 404);
  return c.json(inst);
});

pluginRoutes.openapi(configRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const { config } = c.req.valid('json');
  const result = await pluginsService.updateConfig(workspaceId, id, config, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(enableRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.enable(workspaceId, id, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(disableRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.disable(workspaceId, id, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(pinRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const { version } = c.req.valid('json');
  const result = await pluginsService.pinVersion(workspaceId, id, version, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(uninstallRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.uninstall(workspaceId, id, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.body(null, 204);
});

pluginRoutes.openapi(rollbackRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.rollback(workspaceId, id, getActor(c));
  if (!result.ok) {
    const status = result.error instanceof PluginConflictError ? 409 : 400;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value);
});

pluginRoutes.openapi(eventsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.getEvents(workspaceId, id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

pluginRoutes.openapi(healthRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const inst = await pluginsService.get(workspaceId, id);
  if (!inst) return c.json({ error: 'Not found' }, 404);
  const health = await pluginHealthRepo.getLatest(id);
  return c.json(health ?? { status: 'unknown' });
});

pluginRoutes.openapi(healthRunRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.runHealthCheck(workspaceId, id);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});
