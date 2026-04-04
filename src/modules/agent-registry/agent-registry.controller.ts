import type { Context } from 'hono';
import { agentRegistryService } from './agent-registry.service';
import { registerAgentSchema, agentRegistryIdParamSchema } from './agent-registry.schemas';

export const agentRegistryController = {
  async register(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const body = registerAgentSchema.parse(await c.req.json());
    const result = await agentRegistryService.register(workspaceId, body.url, body.apiKey);
    if (!result.ok) return c.json({ error: result.error.message }, 400);
    return c.json({ data: result.value }, 201);
  },

  async list(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const result = await agentRegistryService.list(workspaceId);
    if (!result.ok) return c.json({ error: result.error.message }, 500);
    return c.json({ data: result.value });
  },

  async remove(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const { agentId } = agentRegistryIdParamSchema.parse(c.req.param());
    const result = await agentRegistryService.remove(workspaceId, agentId);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.body(null, 204);
  },

  async refresh(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const { agentId } = agentRegistryIdParamSchema.parse(c.req.param());
    const body = await c.req.json().catch(() => ({})) as { apiKey?: string };
    const result = await agentRegistryService.refresh(workspaceId, agentId, body.apiKey);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ data: result.value });
  },
};
