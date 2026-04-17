import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { AppEnv } from '../../core/types';
import { routingConfigService } from './routing-config.service';
import { upsertRoutingConfigSchema } from './routing-config.schemas';

export const routingConfigRoutes = new Hono<AppEnv>();

// GET /api/v1/workspaces/:workspaceId/routing-config
routingConfigRoutes.get('/', async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const config = await routingConfigService.getConfig(workspaceId);
  if (!config) return c.json({ config: null });
  return c.json({ config });
});

// PUT /api/v1/workspaces/:workspaceId/routing-config
routingConfigRoutes.put('/', zValidator('json', upsertRoutingConfigSchema), async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const input = c.req.valid('json');
  const config = await routingConfigService.upsert(workspaceId, input);
  return c.json({ config });
});
