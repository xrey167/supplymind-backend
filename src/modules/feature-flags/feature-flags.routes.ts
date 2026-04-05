import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { featureFlagsService } from './feature-flags.service';
import { setFlagBodySchema, flagsResponseSchema } from './feature-flags.schemas';

export const FeatureFlagsRoutes = new OpenAPIHono();

const listFlagsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['feature-flags'],
  summary: 'List all feature flags for this workspace',
  responses: {
    200: { content: { 'application/json': { schema: flagsResponseSchema } }, description: 'Feature flags' },
  },
});

const setFlagRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: ['feature-flags'],
  summary: 'Set a feature flag for this workspace (admin only)',
  request: { body: { content: { 'application/json': { schema: setFlagBodySchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ flag: z.string(), value: z.unknown() }) } }, description: 'Updated' },
    403: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Forbidden' },
  },
});

FeatureFlagsRoutes.openapi(listFlagsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const flags = await featureFlagsService.getAll(workspaceId);
  return c.json(flags, 200);
});

FeatureFlagsRoutes.openapi(setFlagRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerRole = c.get('callerRole') as string | undefined;
  if (!callerRole || callerRole !== 'admin') {
    return c.json({ error: 'Admin role required' }, 403);
  }
  const { flag, value } = c.req.valid('json');
  await featureFlagsService.setFlag(workspaceId, flag, value);
  return c.json({ flag, value }, 200);
});
