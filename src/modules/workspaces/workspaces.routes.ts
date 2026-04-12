import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { workspacesService } from './workspaces.service';
import { createWorkspaceSchema, updateWorkspaceSchema, workspaceIdParamSchema } from './workspaces.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const createWsRoute = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: createWorkspaceSchema } } } },
  responses: { 201: { description: 'Workspace created', ...jsonRes } },
});

const listWsRoute = createRoute({
  method: 'get',
  path: '/',
  responses: { 200: { description: 'List workspaces', ...jsonRes } },
});

const getWsRoute = createRoute({
  method: 'get',
  path: '/{workspaceId}',
  request: { params: workspaceIdParamSchema },
  responses: { 200: { description: 'Workspace details', ...jsonRes } },
});

const updateWsRoute = createRoute({
  method: 'patch',
  path: '/{workspaceId}',
  request: {
    params: workspaceIdParamSchema,
    body: { content: { 'application/json': { schema: updateWorkspaceSchema } } },
  },
  responses: { 200: { description: 'Workspace updated', ...jsonRes } },
});

const deleteWsRoute = createRoute({
  method: 'delete',
  path: '/{workspaceId}',
  request: { params: workspaceIdParamSchema },
  responses: { 204: { description: 'Workspace deleted' }, 403: errRes('Forbidden') },
});

export const WorkspacesRoutes = new OpenAPIHono<AppEnv>();

WorkspacesRoutes.openapi(createWsRoute, async (c) => {
  const body = c.req.valid('json');
  const callerId = c.get('callerId') as string;
  const workspace = await workspacesService.create({ name: body.name, userId: callerId });
  return c.json({ data: workspace }, 201);
});

WorkspacesRoutes.openapi(listWsRoute, async (c) => {
  const callerId = c.get('callerId') as string;
  const workspaces = await workspacesService.listForUser(callerId);
  return c.json({ data: workspaces });
});

WorkspacesRoutes.openapi(getWsRoute, async (c) => {
  const { workspaceId } = c.req.valid('param');
  const workspace = await workspacesService.getById(workspaceId);
  return c.json({ data: workspace });
});

WorkspacesRoutes.openapi(updateWsRoute, async (c) => {
  const { workspaceId } = c.req.valid('param');
  const body = c.req.valid('json');
  const workspace = await workspacesService.update(workspaceId, body);
  return c.json({ data: workspace });
});

WorkspacesRoutes.openapi(deleteWsRoute, async (c) => {
  const { workspaceId } = c.req.valid('param');
  const callerId = c.get('callerId') as string;
  // Owner check — lazy import to avoid circular dep (members module is Task 6)
  const { membersRepo } = await import('../members/members.repo');
  const member = await membersRepo.findMember(workspaceId, callerId);
  if (!member || member.role !== 'owner') {
    return c.json({ error: 'Only workspace owners can delete workspaces' }, 403);
  }
  await workspacesService.delete(workspaceId, callerId);
  return c.body(null, 204);
});
