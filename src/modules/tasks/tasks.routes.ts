import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { tasksService } from './tasks.service';
import { taskSendSchema, taskIdParamSchema, listTasksQuerySchema, addDependencySchema, dependencyParamSchema } from './tasks.schemas';
import { taskEventStream } from '../../infra/realtime/sse-stream';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const sendRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: taskSendSchema } } } },
  responses: { 201: { description: 'Task created', ...jsonRes }, 202: { description: 'Task queued', ...jsonRes } },
});

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listTasksQuerySchema },
  responses: { 200: { description: 'List tasks', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: taskIdParamSchema },
  responses: { 200: { description: 'Task details', ...jsonRes } },
});

const cancelRoute = createRoute({
  method: 'post', path: '/{id}/cancel',
  request: { params: taskIdParamSchema },
  responses: { 200: { description: 'Task canceled', ...jsonRes } },
});

const addDepRoute = createRoute({
  method: 'post', path: '/{id}/dependencies',
  request: { params: taskIdParamSchema, body: { content: { 'application/json': { schema: addDependencySchema } } } },
  responses: { 201: { description: 'Dependency added', ...jsonRes } },
});

const removeDepRoute = createRoute({
  method: 'delete', path: '/{id}/dependencies/{depId}',
  request: { params: dependencyParamSchema },
  responses: { 204: { description: 'Dependency removed' } },
});

const getDepRoute = createRoute({
  method: 'get', path: '/{id}/dependencies',
  request: { params: taskIdParamSchema },
  responses: { 200: { description: 'Task dependencies', ...jsonRes } },
});

export const TasksRoutes = new OpenAPIHono();

TasksRoutes.openapi(sendRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('userId') as string;
  const result = await tasksService.send(body.agentId, body.message, workspaceId, callerId, body.skillId, body.args, body.sessionId, body.runMode);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  if ('queued' in result.value && result.value.queued) {
    return c.json({ taskId: result.value.taskId, jobId: result.value.jobId, status: 'queued' }, 202);
  }
  return c.json(result.value, 201);
});

TasksRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const workspaceId = c.get('workspaceId') as string;
  const tasks = await tasksService.list(workspaceId, { limit: query.limit, cursor: query.cursor });
  return c.json(tasks);
});

TasksRoutes.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');
  const task = tasksService.get(id);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

TasksRoutes.openapi(cancelRoute, async (c) => {
  const { id } = c.req.valid('param');
  const workspaceId = c.get('workspaceId') as string;
  const result = await tasksService.cancel(id, workspaceId);
  if (!result.ok) return c.json({ error: result.error.message }, result.error.statusCode as 404);
  return c.json(result.value);
});

// SSE endpoint stays plain — not describable in OpenAPI
TasksRoutes.get('/:id/events', (c) => {
  const id = c.req.param('id');
  return taskEventStream(c, id);
});

TasksRoutes.openapi(addDepRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { dependsOnTaskId } = c.req.valid('json');
  const result = await tasksService.addDependency(id, dependsOnTaskId);
  if (!result.ok) return c.json({ error: result.error.message }, 409);
  return c.json({}, 201);
});

TasksRoutes.openapi(removeDepRoute, async (c) => {
  const { id, depId } = c.req.valid('param');
  const result = await tasksService.removeDependency(id, depId);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.body(null, 204);
});

TasksRoutes.openapi(getDepRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await tasksService.getDependencies(id);
  if (!result.ok) return c.json({ error: result.error.message }, 500);
  return c.json(result.value);
});
