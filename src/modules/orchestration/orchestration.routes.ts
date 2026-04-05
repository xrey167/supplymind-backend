import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { orchestrationService } from './orchestration.service';
import { createOrchestrationSchema, orchestrationIdParamSchema } from './orchestration.schemas';
import { logger } from '../../config/logger';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createOrchestrationSchema } } } },
  responses: { 201: { description: 'Orchestration created', ...jsonRes } },
});

const runRoute = createRoute({
  method: 'post', path: '/{id}/run',
  request: { params: orchestrationIdParamSchema },
  responses: { 200: { description: 'Orchestration started', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: orchestrationIdParamSchema },
  responses: { 200: { description: 'Orchestration details', ...jsonRes } },
});

export const orchestrationRoutes = new OpenAPIHono();

orchestrationRoutes.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const orch = await orchestrationService.create({ workspaceId, ...body });
  return c.json(orch, 201);
});

orchestrationRoutes.openapi(runRoute, async (c) => {
  const { id } = c.req.valid('param');
  const orch = await orchestrationService.get(id);
  if (!orch) return c.json({ error: 'Orchestration not found' }, 404);

  const workspaceId = orch.workspaceId;
  const definition = orch.definition as any;
  const input = (orch.input as Record<string, unknown>) ?? {};

  orchestrationService.run(id, workspaceId, definition, input).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ orchestrationId: id, workspaceId, error: msg }, 'Orchestration run failed');
    eventBus.publish(Topics.ORCHESTRATION_FAILED, { orchestrationId: id, workspaceId, error: msg });
  });
  return c.json({ orchestrationId: id, status: 'running' });
});

orchestrationRoutes.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');
  const orch = await orchestrationService.get(id);
  if (!orch) return c.json({ error: 'Orchestration not found' }, 404);
  return c.json(orch);
});
