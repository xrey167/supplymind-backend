import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { agentRegistryService } from './agent-registry.service';
import { registerAgentSchema, agentRegistryIdParamSchema } from './agent-registry.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const registerRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: registerAgentSchema } } } },
  responses: { 201: { description: 'Agent registered', ...jsonRes }, 400: errRes('Bad request') },
});

const listRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'List registered agents', ...jsonRes }, 500: errRes('Internal error') },
});

const removeRoute = createRoute({
  method: 'delete', path: '/{agentId}',
  request: { params: agentRegistryIdParamSchema },
  responses: { 204: { description: 'Agent removed' }, 404: errRes('Not found') },
});

const refreshRoute = createRoute({
  method: 'post', path: '/{agentId}/refresh',
  request: { params: agentRegistryIdParamSchema },
  responses: { 200: { description: 'Agent refreshed', ...jsonRes }, 404: errRes('Not found') },
});

export const agentRegistryRoutes = new OpenAPIHono<AppEnv>();

agentRegistryRoutes.openapi(registerRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const body = c.req.valid('json');
  const result = await agentRegistryService.register(workspaceId, body.url, body.apiKey);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json({ data: result.value }, 201);
});

agentRegistryRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const result = await agentRegistryService.list(workspaceId);
  if (!result.ok) return c.json({ error: result.error.message }, 500);
  return c.json({ data: result.value });
});

agentRegistryRoutes.openapi(removeRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { agentId } = c.req.valid('param');
  const result = await agentRegistryService.remove(workspaceId, agentId);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.body(null, 204);
});

agentRegistryRoutes.openapi(refreshRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { agentId } = c.req.valid('param');
  const body = await c.req.json().catch(() => ({})) as { apiKey?: string };
  const result = await agentRegistryService.refresh(workspaceId, agentId, body.apiKey);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json({ data: result.value });
});
