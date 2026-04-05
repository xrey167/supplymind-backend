import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { computerUseService } from './computer-use.service';
import { createSessionSchema, runTaskSchema } from './computer-use.schemas';

export const computerUseRoutes = new OpenAPIHono();

// POST /sessions — create browser session
const createSessionRoute = createRoute({
  method: 'post',
  path: '/sessions',
  tags: ['computer-use'],
  summary: 'Create a computer use browser session',
  request: { body: { content: { 'application/json': { schema: createSessionSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ sessionId: z.string(), viewportWidth: z.number(), viewportHeight: z.number(), createdAt: z.string() }) } }, description: 'Session created' },
    500: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Error' },
  },
});

computerUseRoutes.openapi(createSessionRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const body = c.req.valid('json');
  const result = await computerUseService.createSession(workspaceId, body);
  if (!result.ok) return c.json({ error: result.error.message }, 500);
  return c.json(result.value, 201);
});

// GET /sessions — list sessions for workspace
const listSessionsRoute = createRoute({
  method: 'get',
  path: '/sessions',
  tags: ['computer-use'],
  summary: 'List computer use sessions for this workspace',
  responses: {
    200: { content: { 'application/json': { schema: z.object({ sessions: z.array(z.object({ id: z.string(), workspaceId: z.string(), viewportWidth: z.number(), viewportHeight: z.number(), createdAt: z.string() })) }) } }, description: 'Sessions list' },
  },
});

computerUseRoutes.openapi(listSessionsRoute, (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const result = computerUseService.listSessions(workspaceId);
  const sessions = result.ok
    ? result.value.map(s => ({ ...s, createdAt: s.createdAt.toISOString() }))
    : [];
  return c.json({ sessions });
});

// DELETE /sessions/:sessionId — destroy session
const destroySessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/:sessionId',
  tags: ['computer-use'],
  summary: 'Destroy a computer use session',
  request: { params: z.object({ sessionId: z.string() }) },
  responses: {
    204: { description: 'Session destroyed' },
    404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Not found' },
  },
});

computerUseRoutes.openapi(destroySessionRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { sessionId } = c.req.valid('param');
  const result = await computerUseService.destroySession(sessionId, workspaceId);
  if (!result.ok) {
    const status = (result.error as any).statusCode === 404 ? 404 : 500;
    return c.json({ error: result.error.message }, status as any);
  }
  return new Response(null, { status: 204 });
});

// GET /sessions/:sessionId/screenshot — take a screenshot
const screenshotRoute = createRoute({
  method: 'get',
  path: '/sessions/:sessionId/screenshot',
  tags: ['computer-use'],
  summary: 'Take a screenshot of the current browser state',
  request: { params: z.object({ sessionId: z.string() }) },
  responses: {
    200: { content: { 'image/png': { schema: z.any() } }, description: 'PNG screenshot' },
    404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Not found' },
  },
});

computerUseRoutes.openapi(screenshotRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { sessionId } = c.req.valid('param');
  const result = await computerUseService.screenshot(sessionId, workspaceId);
  if (!result.ok) {
    const status = (result.error as any).statusCode === 404 ? 404 : 500;
    return c.json({ error: result.error.message }, status as any);
  }
  return new Response(result.value, { headers: { 'Content-Type': 'image/png' } });
});

// POST /sessions/:sessionId/run — run a task
const runTaskRoute = createRoute({
  method: 'post',
  path: '/sessions/:sessionId/run',
  tags: ['computer-use'],
  summary: 'Run a computer use task in a browser session',
  request: {
    params: z.object({ sessionId: z.string() }),
    body: { content: { 'application/json': { schema: runTaskSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ output: z.string(), iterations: z.number() }) } }, description: 'Task result' },
    404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Not found' },
    500: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Error' },
  },
});

computerUseRoutes.openapi(runTaskRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { sessionId } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = await computerUseService.runTask(sessionId, workspaceId, body);
  if (!result.ok) {
    const status = (result.error as any).statusCode === 404 ? 404 : 500;
    return c.json({ error: result.error.message }, status as any);
  }
  return c.json(result.value);
});
