import type { Context } from 'hono';
import { sessionsService } from './sessions.service';

export const sessionsController = {
  async create(c: Context) {
    const body = await c.req.json();
    const workspaceId = c.req.param('workspaceId') ?? 'default';
    const session = await sessionsService.create({ workspaceId, ...body });
    return c.json(session, 201);
  },

  async get(c: Context) {
    const session = await sessionsService.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json(session);
  },

  async addMessage(c: Context) {
    const body = await c.req.json();
    const message = await sessionsService.addMessage(c.req.param('id'), body);
    return c.json(message, 201);
  },

  async getMessages(c: Context) {
    const messages = await sessionsService.getMessages(c.req.param('id'));
    return c.json(messages);
  },

  async resume(c: Context) {
    await sessionsService.resume(c.req.param('id'));
    return c.json({ ok: true });
  },

  async close(c: Context) {
    await sessionsService.close(c.req.param('id'));
    return c.json({ ok: true });
  },
};
