import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { memoryService } from './memory.service';
import { saveMemorySchema, recallSchema, proposeMemorySchema, memoryIdParamSchema, proposalIdParamSchema, memoryListQuerySchema, rejectProposalSchema } from './memory.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const saveRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: saveMemorySchema } } } },
  responses: { 201: { description: 'Memory saved', ...jsonRes } },
});

const recallRoute = createRoute({
  method: 'post', path: '/recall',
  request: { body: { content: { 'application/json': { schema: recallSchema } } } },
  responses: { 200: { description: 'Recalled memories', ...jsonRes } },
});

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: memoryListQuerySchema },
  responses: { 200: { description: 'List memories', ...jsonRes } },
});

const forgetRoute = createRoute({
  method: 'delete', path: '/{id}',
  request: { params: memoryIdParamSchema },
  responses: { 204: { description: 'Memory deleted' }, 404: { description: 'Not found', ...jsonRes } },
});

const proposeRoute = createRoute({
  method: 'post', path: '/proposals',
  request: { body: { content: { 'application/json': { schema: proposeMemorySchema } } } },
  responses: { 201: { description: 'Proposal created', ...jsonRes } },
});

const approveProposalRoute = createRoute({
  method: 'post', path: '/proposals/{id}/approve',
  request: { params: proposalIdParamSchema },
  responses: { 200: { description: 'Proposal approved', ...jsonRes } },
});

const rejectProposalRoute = createRoute({
  method: 'post', path: '/proposals/{id}/reject',
  request: { params: proposalIdParamSchema, body: { content: { 'application/json': { schema: rejectProposalSchema } } } },
  responses: { 200: { description: 'Proposal rejected', ...jsonRes } },
});

export const memoryRoutes = new OpenAPIHono<AppEnv>();

memoryRoutes.openapi(saveRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const memory = await memoryService.save({ workspaceId, ...body });
  return c.json(memory, 201);
});

memoryRoutes.openapi(recallRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const memories = await memoryService.recall({ workspaceId, ...body });
  return c.json({ data: memories });
});

memoryRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const query = c.req.valid('query');
  const memories = await memoryService.list(workspaceId, query.agentId);
  return c.json({ data: memories });
});

memoryRoutes.openapi(forgetRoute, async (c) => {
  const { id } = c.req.valid('param');
  const deleted = await memoryService.forget(id);
  if (!deleted) return c.json({ error: 'Memory not found' }, 404);
  return c.body(null, 204);
});

memoryRoutes.openapi(proposeRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const proposal = await memoryService.propose({ workspaceId, ...body });
  return c.json(proposal, 201);
});

memoryRoutes.openapi(approveProposalRoute, async (c) => {
  const { id } = c.req.valid('param');
  const workspaceId = c.get('workspaceId') as string;
  const memory = await memoryService.approveProposal(id, workspaceId);
  return c.json(memory);
});

memoryRoutes.openapi(rejectProposalRoute, async (c) => {
  const { id } = c.req.valid('param');
  const workspaceId = c.get('workspaceId') as string;
  const { reason } = c.req.valid('json');
  await memoryService.rejectProposal(id, workspaceId, reason);
  return c.json({ ok: true });
});
