import type { Context } from 'hono';
import { toolsService } from './tools.service';
import { createToolSchema, updateToolSchema, toolIdParamSchema, listToolsQuerySchema } from './tools.schemas';

export const toolsController = {
  async list(c: Context) {
    const query = listToolsQuerySchema.parse(c.req.query());
    const tools = await toolsService.list(query.workspaceId);
    return c.json({ data: tools });
  },

  async getById(c: Context) {
    const { id } = toolIdParamSchema.parse(c.req.param());
    const result = await toolsService.getById(id);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ data: result.value });
  },

  async create(c: Context) {
    const body = createToolSchema.parse(await c.req.json());
    const result = await toolsService.create(body);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
    return c.json({ data: result.value }, 201);
  },

  async update(c: Context) {
    const { id } = toolIdParamSchema.parse(c.req.param());
    const body = updateToolSchema.parse(await c.req.json());
    const result = await toolsService.update(id, body);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ data: result.value });
  },

  async remove(c: Context) {
    const { id } = toolIdParamSchema.parse(c.req.param());
    await toolsService.remove(id);
    return c.json({ success: true }, 204);
  },
};
