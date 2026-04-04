import { OpenAPIHono } from '@hono/zod-openapi';
import { buildAgentCard } from '../../../infra/a2a/agent-card';
import { taskManager } from '../../../infra/a2a/task-manager';

const publicRoutes = new OpenAPIHono();

// Agent Card discovery
publicRoutes.get('/.well-known/agent.json', (c) => {
  return c.json(buildAgentCard());
});

// A2A JSON-RPC endpoint
publicRoutes.post('/a2a', async (c) => {
  const body = await c.req.json();

  // Simple dispatch based on method
  if (body.method === 'tasks/get') {
    const task = taskManager.get(body.params?.id);
    if (!task) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Task not found' } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: task });
  }
  if (body.method === 'tasks/cancel') {
    const task = taskManager.cancel(body.params?.id);
    if (!task) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Task not found' } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: task });
  }
  if (body.method === 'tasks/send') {
    const params = body.params ?? {};
    const agentId = params.agentId ?? 'default';
    const message = params.message ?? (params.text ? { role: 'user', parts: [{ kind: 'text', text: params.text }] } : undefined);

    // Default agent config for public A2A callers
    // TODO: look up agent config from DB when workspace context is available
    const agentConfig = {
      id: agentId,
      provider: 'anthropic' as const,
      mode: 'raw' as const,
      model: 'claude-sonnet-4-20250514',
      workspaceId: 'public',
      toolIds: [] as string[],
    };

    try {
      const task = await taskManager.send({
        id: params.id,
        message,
        metadata: params.metadata,
        agentConfig,
        callerId: 'a2a',
      });
      return c.json({ jsonrpc: '2.0', id: body.id, result: task });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: msg } });
    }
  }
  return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
});

export { publicRoutes };
