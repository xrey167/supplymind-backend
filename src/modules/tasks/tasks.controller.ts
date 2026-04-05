import type { Context } from 'hono';
import { tasksService } from './tasks.service';
import { taskSendSchema, taskIdParamSchema, listTasksQuerySchema, addDependencySchema, dependencyParamSchema } from './tasks.schemas';
import { taskEventStream } from '../../infra/realtime/sse-stream';

export const tasksController = {
  async sendTask(c: Context) {
    const body = await c.req.json();
    const parsed = taskSendSchema.parse(body);

    // workspaceId and callerId come from auth context
    const workspaceId = c.get('workspaceId') as string;
    const callerId = c.get('userId') as string;

    const result = await tasksService.send(parsed.agentId, parsed.message, workspaceId, callerId, parsed.skillId, parsed.args, parsed.sessionId, parsed.runMode);
    if (!result.ok) return c.json({ error: result.error.message }, 400);

    // Background mode: return queued job info immediately
    if ('queued' in result.value && result.value.queued) {
      return c.json({ taskId: result.value.taskId, jobId: result.value.jobId, status: 'queued' }, 202);
    }

    return c.json(result.value, 201);
  },

  async getTask(c: Context) {
    const { id } = taskIdParamSchema.parse(c.req.param());
    const task = tasksService.get(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
  },

  async cancelTask(c: Context) {
    const { id } = taskIdParamSchema.parse(c.req.param());
    const workspaceId = c.get('workspaceId') as string;
    const result = await tasksService.cancel(id, workspaceId);
    if (!result.ok) return c.json({ error: result.error.message }, result.error.statusCode as 404);
    return c.json(result.value);
  },

  async listTasks(c: Context) {
    const query = listTasksQuerySchema.parse(c.req.query());
    const workspaceId = c.get('workspaceId') as string;
    const tasks = await tasksService.list(workspaceId, { limit: query.limit, cursor: query.cursor });
    return c.json(tasks);
  },

  streamTaskEvents(c: Context) {
    const { id } = taskIdParamSchema.parse(c.req.param());
    return taskEventStream(c, id);
  },

  async addDependency(c: Context) {
    const { id } = taskIdParamSchema.parse(c.req.param());
    const body = await c.req.json();
    const { dependsOnTaskId } = addDependencySchema.parse(body);
    const result = await tasksService.addDependency(id, dependsOnTaskId);
    if (!result.ok) return c.json({ error: result.error.message }, 409);
    return c.json({}, 201);
  },

  async removeDependency(c: Context) {
    const { id, depId } = dependencyParamSchema.parse(c.req.param());
    const result = await tasksService.removeDependency(id, depId);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
    return c.body(null, 204);
  },

  async getDependencies(c: Context) {
    const { id } = taskIdParamSchema.parse(c.req.param());
    const result = await tasksService.getDependencies(id);
    if (!result.ok) return c.json({ error: result.error.message }, 500);
    return c.json(result.value);
  },
};
