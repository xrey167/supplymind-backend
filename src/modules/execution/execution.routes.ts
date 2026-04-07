import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { executionService } from './execution.service';
import { createPlanSchema, planIdParamSchema } from './execution.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const idParam = { request: { params: planIdParamSchema } };

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createPlanSchema } } } },
  responses: { 201: { description: 'Plan created', ...jsonRes }, 400: { description: 'Error', ...jsonRes } },
});
const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: z.object({ limit: z.coerce.number().optional() }) },
  responses: { 200: { description: 'Plans list', ...jsonRes } },
});
const getRoute = createRoute({
  method: 'get', path: '/{id}',
  ...idParam,
  responses: { 200: { description: 'Plan', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});
const runRoute = createRoute({
  method: 'post', path: '/{id}/run',
  ...idParam,
  responses: { 200: { description: 'Submitted', ...jsonRes }, 400: { description: 'Error', ...jsonRes } },
});
const approveRoute = createRoute({
  method: 'post', path: '/{id}/approve',
  ...idParam,
  responses: { 200: { description: 'Approved', ...jsonRes }, 400: { description: 'Error', ...jsonRes } },
});
const runsRoute = createRoute({
  method: 'get', path: '/{id}/runs',
  ...idParam,
  responses: { 200: { description: 'Runs list', ...jsonRes } },
});

export const executionRoutes = new OpenAPIHono();

executionRoutes.openapi(createRoute_, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string | undefined;
  if (!callerId) return c.json({ error: 'Unauthorized' }, 401);
  const body = c.req.valid('json');
  const result = await executionService.create(workspaceId, callerId, body);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value, 201);
});

executionRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { limit } = c.req.valid('query');
  return c.json(await executionService.list(workspaceId, limit));
});

executionRoutes.openapi(getRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const plan = await executionService.get(workspaceId, id);
  if (!plan) return c.json({ error: 'Plan not found' }, 404);
  return c.json(plan);
});

executionRoutes.openapi(runRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const callerId = c.get('callerId') as string | undefined;
  if (!callerId) return c.json({ error: 'Unauthorized' }, 401);
  const result = await executionService.run(workspaceId, id, callerId);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

executionRoutes.openapi(approveRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const callerId = c.get('callerId') as string | undefined;
  if (!callerId) return c.json({ error: 'Unauthorized' }, 401);
  const result = await executionService.approve(workspaceId, id, callerId);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

executionRoutes.openapi(runsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await executionService.getRuns(workspaceId, id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json(result.value);
});
