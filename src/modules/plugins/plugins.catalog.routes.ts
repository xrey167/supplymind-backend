import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { pluginCatalogRepo } from './plugins.catalog.repo';
import { pluginIdParamSchema } from './plugins.schemas';
import { authMiddleware } from '../../api/middlewares/auth';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'Plugin catalog list', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: pluginIdParamSchema },
  responses: { 200: { description: 'Plugin details', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});

export const pluginCatalogRoutes = new OpenAPIHono<AppEnv>();

pluginCatalogRoutes.use('*', authMiddleware);

pluginCatalogRoutes.openapi(listRoute, async (c) => {
  const plugins = await pluginCatalogRepo.listAll();
  return c.json({ data: plugins });
});

pluginCatalogRoutes.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');
  const plugin = await pluginCatalogRepo.findCatalogEntry(id);
  if (!plugin) return c.json({ error: 'Plugin not found' }, 404);
  return c.json({ data: plugin });
});
