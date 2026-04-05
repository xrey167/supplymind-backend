import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { agentsService } from './agents.service';
import { createAgentSchema, updateAgentSchema, agentIdParamSchema, listAgentsQuerySchema } from './agents.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listAgentsQuerySchema },
  responses: { 200: { description: 'List agents', ...jsonRes } },
});

const getByIdRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: agentIdParamSchema },
  responses: { 200: { description: 'Agent details', ...jsonRes } },
});

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createAgentSchema } } } },
  responses: { 201: { description: 'Agent created', ...jsonRes } },
});

const updateRoute = createRoute({
  method: 'patch', path: '/{id}',
  request: { params: agentIdParamSchema, body: { content: { 'application/json': { schema: updateAgentSchema } } } },
  responses: { 200: { description: 'Agent updated', ...jsonRes } },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/{id}',
  request: { params: agentIdParamSchema },
  responses: { 204: { description: 'Agent deleted' } },
});

export const AgentsRoutes = new OpenAPIHono();

AgentsRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const agents = await agentsService.list(query.workspaceId);
  return c.json({ data: agents });
});

AgentsRoutes.openapi(getByIdRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await agentsService.getById(id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

AgentsRoutes.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');
  const result = await agentsService.create(body);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value }, 201);
});

AgentsRoutes.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await agentsService.update(id, body);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

AgentsRoutes.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  await agentsService.remove(id);
  return c.json({ success: true }, 204);
});
