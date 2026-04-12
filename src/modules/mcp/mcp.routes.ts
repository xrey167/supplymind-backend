import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { mcpService } from './mcp.service';
import { createMcpSchema, updateMcpSchema, mcpIdParamSchema } from './mcp.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const listRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'List MCP servers', ...jsonRes }, 500: errRes('Internal error') },
});

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createMcpSchema } } } },
  responses: { 201: { description: 'MCP server created', ...jsonRes }, 400: errRes('Bad request') },
});

const updateRoute = createRoute({
  method: 'patch', path: '/{mcpId}',
  request: { params: mcpIdParamSchema, body: { content: { 'application/json': { schema: updateMcpSchema } } } },
  responses: { 200: { description: 'MCP server updated', ...jsonRes }, 404: errRes('Not found') },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/{mcpId}',
  request: { params: mcpIdParamSchema },
  responses: { 204: { description: 'MCP server deleted' }, 404: errRes('Not found') },
});

const testRoute = createRoute({
  method: 'post', path: '/{mcpId}/test',
  request: { params: mcpIdParamSchema },
  responses: { 200: { description: 'Connection test result', ...jsonRes }, 400: errRes('Bad request') },
});

export const mcpRoutes = new OpenAPIHono<AppEnv>();

mcpRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const result = await mcpService.list(workspaceId);
  if (!result.ok) return c.json({ error: result.error.message }, 500);
  return c.json({ data: result.value });
});

mcpRoutes.openapi(createRoute_, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const body = c.req.valid('json');
  const result = await mcpService.create(workspaceId, body);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value }, 201);
});

mcpRoutes.openapi(updateRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { mcpId } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await mcpService.update(workspaceId, mcpId, body);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});

mcpRoutes.openapi(deleteRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { mcpId } = c.req.valid('param');
  const result = await mcpService.remove(workspaceId, mcpId);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.body(null, 204);
});

mcpRoutes.openapi(testRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { mcpId } = c.req.valid('param');
  const result = await mcpService.testConnection(workspaceId, mcpId);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value });
});
