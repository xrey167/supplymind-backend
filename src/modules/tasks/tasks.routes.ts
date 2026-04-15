import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { tasksService } from './tasks.service';
import { taskSendSchema, taskIdParamSchema, listTasksQuerySchema, addDependencySchema, dependencyParamSchema } from './tasks.schemas';
import { taskEventStream } from '../../infra/realtime/sse-stream';
import { taskRepo } from '../../engine/a2a/task-repo';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const sendRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: taskSendSchema } } } },
  responses: { 201: { description: 'Task created', ...jsonRes }, 202: { description: 'Task queued', ...jsonRes }, 400: errRes('Bad request') },
});

const listRoute = createRoute({
  method: 'get', path: '/',
  request: { query: listTasksQuerySchema },
  responses: { 200: { description: 'List tasks', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: taskIdParamSchema },
  responses: { 200: { description: 'Task details', ...jsonRes }, 404: errRes('Not found') },
});

const cancelRoute = createRoute({
  method: 'post', path: '/{id}/cancel',
  request: { params: taskIdParamSchema },
  responses: { 200: { description: 'Task canceled', ...jsonRes }, 404: errRes('Not found') },
});

const addDepRoute = createRoute({
  method: 'post', path: '/{id}/dependencies',
  request: { params: taskIdParamSchema, body: { content: { 'application/json': { schema: addDependencySchema } } } },
  responses: { 201: { description: 'Dependency added', ...jsonRes }, 409: errRes('Conflict') },
});

const removeDepRoute = createRoute({
  method: 'delete', path: '/{id}/dependencies/{depId}',
  request: { params: dependencyParamSchema },
  responses: { 204: { description: 'Dependency removed' }, 400: errRes('Bad request') },
});

const getDepRoute = createRoute({
  method: 'get', path: '/{id}/dependencies',
  request: { params: taskIdParamSchema },
  responses: { 200: { description: 'Task dependencies', ...jsonRes }, 500: errRes('Internal error') },
});

export const TasksRoutes = new OpenAPIHono<AppEnv>();

/** Normalize an A2ATask-like object to the flat API shape tests expect */
function normalizeTask(task: { id: string; status: { state: string } | string; [k: string]: unknown }, extras?: Record<string, unknown>) {
  const status = typeof task.status === 'object' && task.status !== null
    ? (task.status as { state: string }).state
    : task.status;
  return { ...task, ...extras, status };
}

TasksRoutes.openapi(sendRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const callerId = (c.get('callerId') as string) ?? (c.get('userId') as string);
  const result = await tasksService.send(body.agentId, body.message, workspaceId, callerId, body.skillId, body.args, body.sessionId, body.runMode);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  if ('queued' in result.value && result.value.queued) {
    return c.json({ data: { id: result.value.taskId, agentId: body.agentId, status: 'submitted', workspaceId } }, 201);
  }
  const task = result.value as { id: string; status: { state: string }; [k: string]: unknown };
  return c.json({ data: normalizeTask(task, { agentId: body.agentId }) }, 201);
});

TasksRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const workspaceId = c.get('workspaceId') as string;
  const tasks = await tasksService.list(workspaceId, { limit: query.limit, cursor: query.cursor });
  return c.json({ data: tasks.map(t => normalizeTask(t as any)) });
});

TasksRoutes.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');
  // Check in-memory first (running tasks), fall back to DB
  const inMemory = tasksService.get(id);
  if (inMemory) return c.json({ data: normalizeTask(inMemory as any) });
  const dbTask = await taskRepo.findRawById(id);
  if (!dbTask) return c.json({ error: 'Task not found' }, 404);
  return c.json({ data: { id: dbTask.id, agentId: dbTask.agentId, workspaceId: dbTask.workspaceId, status: dbTask.status ?? 'submitted', createdAt: dbTask.createdAt } });
});

TasksRoutes.openapi(cancelRoute, async (c) => {
  const { id } = c.req.valid('param');
  const workspaceId = c.get('workspaceId') as string;
  const result = await tasksService.cancel(id, workspaceId);
  if (!result.ok) return c.json({ error: result.error.message }, result.error.statusCode as 404);
  return c.json({ data: normalizeTask(result.value as any) });
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
  return c.json({ data: { taskId: id, dependsOnTaskId } }, 201);
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
  // Return as array of dependency objects matching test expectations
  const deps = result.value.blockedBy.map((dependsOnTaskId: string) => ({ taskId: id, dependsOnTaskId }));
  return c.json({ data: deps });
});
