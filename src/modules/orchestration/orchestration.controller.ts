import type { Context } from 'hono';
import { orchestrationService } from './orchestration.service';

export const orchestrationController = {
  async create(c: Context) {
    const body = await c.req.json();
    const workspaceId = c.req.param('workspaceId') ?? 'default';
    const orch = await orchestrationService.create({ workspaceId, ...body });
    return c.json(orch, 201);
  },

  async run(c: Context) {
    const id = c.req.param('id');
    const orch = await orchestrationService.get(id);
    if (!orch) return c.json({ error: 'Orchestration not found' }, 404);

    const workspaceId = orch.workspaceId;
    const definition = orch.definition as any;
    const input = (orch.input as Record<string, unknown>) ?? {};

    orchestrationService.run(id, workspaceId, definition, input).catch(() => {});
    return c.json({ orchestrationId: id, status: 'running' });
  },

  async get(c: Context) {
    const orch = await orchestrationService.get(c.req.param('id'));
    if (!orch) return c.json({ error: 'Orchestration not found' }, 404);
    return c.json(orch);
  },
};
