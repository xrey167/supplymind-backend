import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { sessionsService } from './sessions.service';
import { createSessionSchema, addMessageSchema, sessionIdParamSchema, transcriptQuerySchema } from './sessions.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const createRoute_ = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createSessionSchema } } } },
  responses: { 201: { description: 'Session created', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: sessionIdParamSchema },
  responses: { 200: { description: 'Session details', ...jsonRes } },
});

const addMessageRoute = createRoute({
  method: 'post', path: '/{id}/messages',
  request: { params: sessionIdParamSchema, body: { content: { 'application/json': { schema: addMessageSchema } } } },
  responses: { 201: { description: 'Message added', ...jsonRes } },
});

const getMessagesRoute = createRoute({
  method: 'get', path: '/{id}/messages',
  request: { params: sessionIdParamSchema },
  responses: { 200: { description: 'Session messages', ...jsonRes } },
});

const transcriptRoute = createRoute({
  method: 'get', path: '/{id}/transcript',
  request: { params: sessionIdParamSchema, query: transcriptQuerySchema },
  responses: { 200: { description: 'Session transcript', ...jsonRes } },
});

const resumeRoute = createRoute({
  method: 'post', path: '/{id}/resume',
  request: { params: sessionIdParamSchema },
  responses: { 200: { description: 'Session resumed', ...jsonRes } },
});

const closeRoute = createRoute({
  method: 'post', path: '/{id}/close',
  request: { params: sessionIdParamSchema },
  responses: { 200: { description: 'Session closed', ...jsonRes } },
});

export const sessionsRoutes = new OpenAPIHono();

sessionsRoutes.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.param('workspaceId');
  const session = await sessionsService.create({ workspaceId, ...body });
  return c.json(session, 201);
});

sessionsRoutes.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');
  const session = await sessionsService.get(id);
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(session);
});

sessionsRoutes.openapi(addMessageRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const message = await sessionsService.addMessage(id, body);
  return c.json(message, 201);
});

sessionsRoutes.openapi(getMessagesRoute, async (c) => {
  const { id } = c.req.valid('param');
  const messages = await sessionsService.getMessages(id);
  return c.json(messages);
});

sessionsRoutes.openapi(transcriptRoute, async (c) => {
  const { id } = c.req.valid('param');
  const query = c.req.valid('query');
  const workspaceId = c.get('workspaceId') as string | undefined;

  const session = await sessionsService.get(id);
  if (!session || session.workspaceId !== workspaceId) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const result = await sessionsService.getTranscript(id, query);
  return c.json(result);
});

sessionsRoutes.openapi(resumeRoute, async (c) => {
  const { id } = c.req.valid('param');
  await sessionsService.resume(id);
  return c.json({ ok: true });
});

sessionsRoutes.openapi(closeRoute, async (c) => {
  const { id } = c.req.valid('param');
  await sessionsService.close(id);
  return c.json({ ok: true });
});
