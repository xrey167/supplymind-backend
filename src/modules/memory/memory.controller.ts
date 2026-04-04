import type { Context } from 'hono';
import { memoryService } from './memory.service';

export const memoryController = {
  async save(c: Context) {
    const body = await c.req.json();
    const workspaceId = c.req.param('workspaceId') ?? 'default';
    const memory = await memoryService.save({ workspaceId, ...body });
    return c.json(memory, 201);
  },

  async recall(c: Context) {
    const body = await c.req.json();
    const workspaceId = c.req.param('workspaceId') ?? 'default';
    const memories = await memoryService.recall({ workspaceId, ...body });
    return c.json(memories);
  },

  async list(c: Context) {
    const workspaceId = c.req.param('workspaceId') ?? 'default';
    const agentId = c.req.query('agentId');
    const memories = await memoryService.list(workspaceId, agentId);
    return c.json(memories);
  },

  async forget(c: Context) {
    const deleted = await memoryService.forget(c.req.param('id'));
    if (!deleted) return c.json({ error: 'Memory not found' }, 404);
    return c.json({ ok: true });
  },

  async propose(c: Context) {
    const body = await c.req.json();
    const workspaceId = c.req.param('workspaceId') ?? 'default';
    const proposal = await memoryService.propose({ workspaceId, ...body });
    return c.json(proposal, 201);
  },

  async approveProposal(c: Context) {
    const memory = await memoryService.approveProposal(c.req.param('id'));
    return c.json(memory);
  },

  async rejectProposal(c: Context) {
    const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
    await memoryService.rejectProposal(c.req.param('id'), reason);
    return c.json({ ok: true });
  },
};
