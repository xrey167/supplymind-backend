import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { toolsService } from './tools.service';
import { createToolSchema, updateToolSchema, toolIdParamSchema, listToolsQuerySchema } from './tools.schemas';
import { requireRole } from '../../api/middlewares/auth';
import { Roles } from '../../core/security/rbac';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listToolsQuerySchema },
  responses: { 200: { description: 'List tools', ...jsonRes } },
});

const getByIdRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: toolIdParamSchema },
  responses: { 200: { description: 'Tool details', ...jsonRes } },
});

const createRoute_ = createRoute({
  method: 'post', path: '/',
  middleware: [requireRole(Roles.OPERATOR)] as any,
  request: { body: { content: { 'application/json': { schema: createToolSchema } } } },
  responses: { 201: { description: 'Tool created', ...jsonRes } },
});

const updateRoute = createRoute({
  method: 'patch', path: '/{id}',
  middleware: [requireRole(Roles.OPERATOR)] as any,
  request: { params: toolIdParamSchema, body: { content: { 'application/json': { schema: updateToolSchema } } } },
  responses: { 200: { description: 'Tool updated', ...jsonRes } },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/{id}',
  middleware: [requireRole(Roles.ADMIN)] as any,
  request: { params: toolIdParamSchema },
  responses: { 204: { description: 'Tool deleted' } },
});

export const ToolsRoutes = new OpenAPIHono();

ToolsRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const tools = await toolsService.list(query.workspaceId);
  return c.json({ data: tools });
});

ToolsRoutes.openapi(getByIdRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await toolsService.getById(id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

ToolsRoutes.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');
  const result = await toolsService.create(body);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value }, 201);
});

ToolsRoutes.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await toolsService.update(id, body);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

ToolsRoutes.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  await toolsService.remove(id);
  return c.json({ success: true }, 204);
});
