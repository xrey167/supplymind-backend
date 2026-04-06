import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { healthService } from './health.service';
import { readinessResponseSchema } from './health.schemas';

export const HealthRoutes = new OpenAPIHono();

const healthRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['health'],
  summary: 'Health / readiness check',
  responses: {
    200: {
      content: { 'application/json': { schema: readinessResponseSchema } },
      description: 'Health status',
    },
  },
});

HealthRoutes.openapi(healthRoute, async (c) => {
  const result = await healthService.readiness();
  return c.json(result, 200);
});
