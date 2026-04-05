import type { Context } from 'hono';
import { mcpService } from './mcp.service';
import { createMcpSchema, updateMcpSchema, mcpIdParamSchema } from './mcp.schemas';

export const mcpController = {
  async list(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const result = await mcpService.list(workspaceId);
    if (!result.ok) return c.json({ error: result.error.message }, 500);
    return c.json({ data: result.value });
  },

  async create(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const body = createMcpSchema.parse(await c.req.json());
    const result = await mcpService.create(workspaceId, body);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
    return c.json({ data: result.value }, 201);
  },

  async update(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const { mcpId } = mcpIdParamSchema.parse(c.req.param());
    const body = updateMcpSchema.parse(await c.req.json());
    const result = await mcpService.update(workspaceId, mcpId, body);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ data: result.value });
  },

  async remove(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const { mcpId } = mcpIdParamSchema.parse(c.req.param());
    const result = await mcpService.remove(workspaceId, mcpId);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.body(null, 204);
  },

  async testConnection(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const { mcpId } = mcpIdParamSchema.parse(c.req.param());
    const result = await mcpService.testConnection(workspaceId, mcpId);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
    return c.json({ data: result.value });
  },
};
