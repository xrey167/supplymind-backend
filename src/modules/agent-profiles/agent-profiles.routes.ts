import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import { AppError } from '../../core/errors';
import { agentProfilesService } from './agent-profiles.service';
import {
  createAgentProfileSchema,
  updateAgentProfileSchema,
  agentProfileIdParamSchema,
  listAgentProfilesQuerySchema,
} from './agent-profiles.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const workspaceParam = z.object({ workspaceId: z.string().uuid() });

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listAgentProfilesQuerySchema },
  responses: { 200: { description: 'List agent profiles', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{profileId}',
  request: { params: agentProfileIdParamSchema },
  responses: { 200: { description: 'Agent profile', ...jsonRes }, 404: errRes('Not found') },
});

const createProfileRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createAgentProfileSchema } } } },
  responses: { 201: { description: 'Created', ...jsonRes }, 400: errRes('Bad request') },
});

const updateRoute = createRoute({
  method: 'patch', path: '/{profileId}',
  request: {
    params: agentProfileIdParamSchema,
    body: { content: { 'application/json': { schema: updateAgentProfileSchema } } },
  },
  responses: { 200: { description: 'Updated', ...jsonRes }, 404: errRes('Not found') },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/{profileId}',
  request: { params: agentProfileIdParamSchema },
  responses: { 204: { description: 'Deleted' }, 404: errRes('Not found') },
});

export const AgentProfilesRoutes = new OpenAPIHono<AppEnv>();

AgentProfilesRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId');
  const { category } = c.req.valid('query');
  const profiles = await agentProfilesService.list(workspaceId, category);
  return c.json({ data: profiles });
});

AgentProfilesRoutes.openapi(getRoute, async (c) => {
  const { profileId } = c.req.valid('param');
  const r = await agentProfilesService.get(profileId);
  if (!r.ok) {
    const status = r.error instanceof AppError ? r.error.statusCode : 500;
    return c.json({ error: r.error.message }, status as 404 | 500);
  }
  return c.json({ data: r.value });
});

AgentProfilesRoutes.openapi(createProfileRoute, async (c) => {
  const workspaceId = c.get('workspaceId');
  const body = c.req.valid('json');
  const r = await agentProfilesService.create(workspaceId, body);
  if (!r.ok) return c.json({ error: r.error.message }, 400);
  return c.json({ data: r.value }, 201);
});

AgentProfilesRoutes.openapi(updateRoute, async (c) => {
  const { profileId } = c.req.valid('param');
  const body = c.req.valid('json');
  const r = await agentProfilesService.update(profileId, body);
  if (!r.ok) {
    const status = r.error instanceof AppError ? r.error.statusCode : 500;
    return c.json({ error: r.error.message }, status as 404 | 500);
  }
  return c.json({ data: r.value });
});

AgentProfilesRoutes.openapi(deleteRoute, async (c) => {
  const { profileId } = c.req.valid('param');
  const r = await agentProfilesService.remove(profileId);
  if (!r.ok) {
    const status = r.error instanceof AppError ? r.error.statusCode : 500;
    return c.json({ error: r.error.message }, status as 404 | 500);
  }
  return c.body(null, 204);
});
