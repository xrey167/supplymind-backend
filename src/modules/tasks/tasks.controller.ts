import type { Context } from 'hono';
import { tasksService } from './tasks.service';
import { taskSendSchema, taskIdParamSchema, listTasksQuerySchema } from './tasks.schemas';
import { taskEventStream } from '../../infra/realtime/sse-stream';

export const tasksController = {
  async sendTask(c: Context) {
    const body = await c.req.json();
    const parsed = taskSendSchema.parse(body);

    // workspaceId and callerId come from auth context
    const workspaceId = c.get('workspaceId') as string;
    const callerId = c.get('userId') as string;

    const result = await tasksService.send(parsed.agentId, parsed.message, workspaceId, callerId, parsed.skillId, parsed.args);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
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
    const task = tasksService.cancel(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
  },

  async listTasks(c: Context) {
    const query = listTasksQuerySchema.parse(c.req.query());
    const workspaceId = query.workspaceId ?? (c.get('workspaceId') as string);
    const tasks = await tasksService.list(workspaceId);
    return c.json(tasks);
  },

  streamTaskEvents(c: Context) {
    const { id } = taskIdParamSchema.parse(c.req.param());
    return taskEventStream(c, id);
  },
};
