import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { usageService } from './usage.service';
import { usageQuerySchema, usageSummaryResponseSchema } from './usage.schemas';

export const usageRoutes = new OpenAPIHono();

const getUsageRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['usage'],
  summary: 'Get workspace AI usage and cost summary',
  request: { query: usageQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: usageSummaryResponseSchema } }, description: 'Usage summary' },
    500: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Error' },
  },
});

usageRoutes.openapi(getUsageRoute, async (c) => {
  const workspaceId = c.get('workspaceId');
  if (!workspaceId) return c.json({ error: 'Unauthorized' }, 401 as any);
  const { period } = c.req.valid('query');
  try {
    const summary = await usageService.getWorkspaceSummary(workspaceId, period ?? 'month');
    return c.json({ data: summary }, 200);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
