import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { orchestrationService } from './orchestration.service';
import { createOrchestrationSchema, orchestrationIdParamSchema } from './orchestration.schemas';
import { enqueueOrchestration } from '../../infra/queue/bullmq';
import type { OrchestrationDefinition } from './orchestration.types';
import { AppError } from '../../core/errors';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createOrchestrationSchema } } } },
  responses: { 201: { description: 'Orchestration created', ...jsonRes } },
});

const runRoute = createRoute({
  method: 'post', path: '/{id}/run',
  request: { params: orchestrationIdParamSchema },
  responses: { 200: { description: 'Orchestration started', ...jsonRes }, 404: errRes('Not found'), 503: errRes('Service unavailable') },
});

const getRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: orchestrationIdParamSchema },
  responses: { 200: { description: 'Orchestration details', ...jsonRes }, 404: errRes('Not found') },
});

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().optional() }) },
  responses: { 200: { description: 'Orchestration list', ...jsonRes } },
});

const cancelRoute = createRoute({
  method: 'post', path: '/{id}/cancel',
  request: { params: orchestrationIdParamSchema },
  responses: { 200: { description: 'Cancelled', ...jsonRes }, 400: { description: 'Cannot cancel', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});

export const orchestrationRoutes = new OpenAPIHono<AppEnv>();

orchestrationRoutes.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const orch = await orchestrationService.create({ workspaceId, ...body } as Parameters<typeof orchestrationService.create>[0]);
  return c.json(orch, 201);
});

orchestrationRoutes.openapi(runRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const orch = await orchestrationService.get(id);
  if (!orch || orch.workspaceId !== workspaceId) return c.json({ error: 'Orchestration not found' }, 404);

  const definition = orch.definition as OrchestrationDefinition;
  const input = (orch.input as Record<string, unknown>) ?? {};

  try {
    await enqueueOrchestration({ orchestrationId: id, workspaceId, definition, input });
  } catch {
    return c.json({ error: 'Failed to schedule orchestration execution. Please try again.' }, 503);
  }
  return c.json({ orchestrationId: id, status: 'submitted' });
});

orchestrationRoutes.openapi(getRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const orch = await orchestrationService.get(id);
  if (!orch || orch.workspaceId !== workspaceId) return c.json({ error: 'Orchestration not found' }, 404);
  return c.json(orch);
});

orchestrationRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { limit, cursor } = c.req.valid('query');
  const rows = await orchestrationService.list(workspaceId, { limit, cursor });
  const lastRow = rows[rows.length - 1];
  const nextCursor = rows.length === (limit ?? 20) && lastRow?.createdAt && lastRow?.id
    ? `${lastRow.createdAt.toISOString()}|${lastRow.id}`
    : null;
  return c.json({ data: rows, nextCursor });
});

orchestrationRoutes.openapi(cancelRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await orchestrationService.cancel(id, workspaceId);
  if (!result.ok) {
    const status = (result.error as AppError).statusCode === 404 ? 404 : 400;
    return c.json({ error: result.error.message }, status as 400 | 404);
  }
  return c.json({ orchestrationId: id, status: 'cancelled' });
});
