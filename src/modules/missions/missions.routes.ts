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
  approveBodySchema,
  inputBodySchema,
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
  responses: { 200: { description: 'Mission', ...jsonRes }, 400: errRes('Bad request'), 404: errRes('Not found'), 409: errRes('Conflict'), 500: errRes('Internal error') },
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
    400: errRes('Bad request'),
    404: errRes('Not found'),
    409: errRes('Conflict'),
    500: errRes('Internal error'),
  },
});

const pauseRoute = createRoute({
  method: 'post', path: '/{missionId}/pause',
  request: { params: missionIdParamSchema },
  responses: {
    200: { description: 'Mission paused', ...jsonRes },
    400: errRes('Bad request'),
    404: errRes('Not found'),
    409: errRes('Conflict'),
    500: errRes('Internal error'),
  },
});

const cancelRoute = createRoute({
  method: 'delete', path: '/{missionId}',
  request: { params: missionIdParamSchema },
  responses: {
    200: { description: 'Mission cancelled', ...jsonRes },
    400: errRes('Bad request'),
    404: errRes('Not found'),
    409: errRes('Conflict'),
    500: errRes('Internal error'),
  },
});

const listArtifactsRoute = createRoute({
  method: 'get', path: '/{missionId}/artifacts',
  request: { params: missionIdParamSchema },
  responses: { 200: { description: 'Artifacts', ...jsonRes }, 404: errRes('Not found'), 400: errRes('Bad request'), 409: errRes('Conflict'), 500: errRes('Internal error') },
});

const createArtifactRoute = createRoute({
  method: 'post', path: '/{missionId}/artifacts',
  request: {
    params: missionIdParamSchema,
    body: { content: { 'application/json': { schema: createArtifactSchema } } },
  },
  responses: { 201: { description: 'Artifact created', ...jsonRes }, 400: errRes('Bad request'), 404: errRes('Not found'), 409: errRes('Conflict'), 500: errRes('Internal error') },
});

const listEventsRoute = createRoute({
  method: 'get', path: '/{missionId}/events',
  request: { params: missionIdParamSchema, query: eventsQuerySchema },
  responses: { 200: { description: 'Mission events', ...jsonRes }, 400: errRes('Bad request'), 404: errRes('Not found'), 409: errRes('Conflict'), 500: errRes('Internal error') },
});

const runCostRoute = createRoute({
  method: 'get', path: '/{missionId}/runs/{runId}/cost',
  request: { params: runCostParamSchema },
  responses: { 200: { description: 'Run cost breakdown', ...jsonRes }, 400: errRes('Bad request'), 404: errRes('Not found'), 409: errRes('Conflict'), 500: errRes('Internal error') },
});

const approveRoute = createRoute({
  method: 'post', path: '/{missionId}/approve',
  request: {
    params: missionIdParamSchema,
    body: { content: { 'application/json': { schema: approveBodySchema } } },
  },
  responses: {
    200: { description: 'Mission approved or rejected', ...jsonRes },
    400: errRes('Bad request'),
    404: errRes('Not found'),
    409: errRes('Conflict'),
    500: errRes('Internal error'),
  },
});

const inputRoute = createRoute({
  method: 'post', path: '/{missionId}/input',
  request: {
    params: missionIdParamSchema,
    body: { content: { 'application/json': { schema: inputBodySchema } } },
  },
  responses: {
    200: { description: 'External input received', ...jsonRes },
    400: errRes('Bad request'),
    404: errRes('Not found'),
    409: errRes('Conflict'),
    500: errRes('Internal error'),
  },
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
  const workspaceId = c.get('workspaceId');
  const { missionId } = c.req.valid('param');
  const { limit } = c.req.valid('query');
  const events = await missionEventsRepo.listByMissionRun(missionId, workspaceId, limit);
  return c.json({ data: events });
});

MissionsRoutes.openapi(runCostRoute, async (c) => {
  const { runId } = c.req.valid('param');
  const result = await missionsService.getRunCost(runId);
  return c.json({ data: result });
});

MissionsRoutes.openapi(approveRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const { approved, comment } = c.req.valid('json');
  const r = await missionsService.approve(missionId, approved, comment);
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value });
});

MissionsRoutes.openapi(inputRoute, async (c) => {
  const { missionId } = c.req.valid('param');
  const { payload } = c.req.valid('json');
  const r = await missionsService.input(missionId, payload);
  if (!r.ok) return c.json({ error: r.error.message }, errorStatus(r.error));
  return c.json({ data: r.value });
});
