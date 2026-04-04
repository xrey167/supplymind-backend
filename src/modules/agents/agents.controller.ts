import type { Context } from 'hono';
import { agentsService } from './agents.service';
import { createAgentSchema, updateAgentSchema, agentIdParamSchema, listAgentsQuerySchema } from './agents.schemas';

export const agentsController = {
  async list(c: Context) {
    const query = listAgentsQuerySchema.parse(c.req.query());
    const agents = await agentsService.list(query.workspaceId);
    return c.json({ data: agents });
  },

  async getById(c: Context) {
    const { id } = agentIdParamSchema.parse(c.req.param());
    const result = await agentsService.getById(id);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ data: result.value });
  },

  async create(c: Context) {
    const body = createAgentSchema.parse(await c.req.json());
    const result = await agentsService.create(body);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
    return c.json({ data: result.value }, 201);
  },

  async update(c: Context) {
    const { id } = agentIdParamSchema.parse(c.req.param());
    const body = updateAgentSchema.parse(await c.req.json());
    const result = await agentsService.update(id, body);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ data: result.value });
  },

  async remove(c: Context) {
    const { id } = agentIdParamSchema.parse(c.req.param());
    await agentsService.remove(id);
    return c.json({ success: true }, 204);
  },
};
