import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import { AppError } from '../../core/errors';
import { missionsService } from './missions.service';
import { missionEventsRepo } from './mission-events.repo';
import {
  createMissionSchema,
  missionIdParamSchema,
  listMissionsQuerySchema,
  createArtifactSchema,
  eventsQuerySchema,
  analyticsQuerySchema,
  runCostParamSchema,
} from './missions.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

function errorStatus(e: unknown): 400 | 404 | 409 | 500 {
  if (e instanceof AppError) return e.statusCode as 400 | 404 | 409 | 500;
  return 500;
}

// ── Route definitions (analytics MUST be before /{missionId} to avoid capture) ──

const analyticsRoute = createRoute({
  method: 'get', path: '/analytics',
  request: { query: analyticsQuerySchema },
  responses: { 200: { description: 'Cost analytics', ...jsonRes } },
});

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listMissionsQuerySchema },
  responses: { 200: { description: 'List missions', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{missionId}',
  request: { params: missionIdParamSchema },
  responses: { 200: { description: 'Mission', ...jsonRes }, 404: errRes('Not found') },
});

const createMissionRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createMissionSchema } } } },
  responses: { 201: { description: 'Created', ...jsonRes }, 400: errRes('Bad request') },
});

const startRoute = createRoute({
  method: 'post', path: '/{missionId}/start',
  request: { params: missionIdParamSchema },
  responses: {
    200: { description: 'Mission started', ...jsonRes },
    404: errRes('Not found'),
    409: errRes('Conflict'),
  },
});

const pauseRoute = createRoute({
  method: 'post', path: '/{missionId}/pause',
  request: { params: missionIdParamSchema },
  responses: {
    200: { description: 'Mission paused', ...jsonRes },
    404: errRes('Not found'),
    409: errRes('Conflict'),
  },
});

const cancelRoute = createRoute({
  method: 'delete', path: '/{missionId}',
  request: { params: missionIdParamSchema },
  responses: {
    200: { description: 'Mission cancelled', ...jsonRes },
    404: errRes('Not found'),
    409: errRes('Conflict'),
  },
});

const listArtifactsRoute = createRoute({
  method: 'get', path: '/{missionId}/artifacts',
  request: { params: missionIdParamSchema },
  responses: { 200: { description: 'Artifacts', ...jsonRes }, 404: errRes('Not found') },
});

const createArtifactRoute = createRoute({
  method: 'post', path: '/{missionId}/artifacts',
  request: {
    params: missionIdParamSchema,
    body: { content: { 'application/json': { schema: createArtifactSchema } } },
  },
  responses: { 201: { description: 'Artifact created', ...jsonRes }, 404: errRes('Not found') },
});

const listEventsRoute = createRoute({
  method: 'get', path: '/{missionId}/events',
  request: { params: missionIdParamSchema, query: eventsQuerySchema },
  responses: { 200: { description: 'Mission events', ...jsonRes }, 404: errRes('Not found') },
});

const runCostRoute = createRoute({
  method: 'get', path: '/{missionId}/runs/{runId}/cost',
  request: { params: runCostParamSchema },
  responses: { 200: { description: 'Run cost breakdown', ...jsonRes }, 404: errRes('Not found') },
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export const MissionsRoutes = new OpenAPIHono<AppEnv>();

MissionsRoutes.openapi(analyticsRoute, async (c) => {
  const workspaceId = c.get('workspaceId');
  const { period, since, until } = c.req.valid('query');
  const result = await missionsService.getAnalytics(workspaceId, { period, since, until });
  return c.json({ data: result });
});

MissionsRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId');
  const { limit, cursor } = c.req.valid('query');
  const missions = await missionsService.list(workspaceId, { limit, cursor });
  return c.json({ data: missions });
});

MissionsRoutes.openapi(getRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const r = await missionsService.get(missionId);
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value });
});

MissionsRoutes.openapi(createMissionRoute, async (c) => {
  const workspaceId = c.get('workspaceId');
  const body = c.req.valid('json');
  const r = await missionsService.create(workspaceId, body);
  if (!r.ok) return c.json({ error: r.error.message }, 400);
  return c.json({ data: r.value }, 201);
});

MissionsRoutes.openapi(startRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const r = await missionsService.start(missionId);
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value });
});

MissionsRoutes.openapi(pauseRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const r = await missionsService.pause(missionId);
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value });
});

MissionsRoutes.openapi(cancelRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const r = await missionsService.cancel(missionId);
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value });
});

MissionsRoutes.openapi(listArtifactsRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const r = await missionsService.getArtifacts(missionId);
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value });
});

MissionsRoutes.openapi(createArtifactRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const body = c.req.valid('json');
  const r = await missionsService.emitArtifact({ missionRunId: missionId, ...body });
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value }, 201);
});

MissionsRoutes.openapi(listEventsRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const { limit } = c.req.valid('query');
  const events = await missionEventsRepo.listByMissionRun(missionId, limit);
  return c.json({ data: events });
});

MissionsRoutes.openapi(runCostRoute, async (c) => {
  const { runId } = c.req.valid('param');
  const result = await missionsService.getRunCost(runId);
  return c.json({ data: result });
});
