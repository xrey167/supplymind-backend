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
    // For now, return error -- needs agent config lookup which requires workspace context
    // Will be fully wired in Phase 7
    return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Use /api/v1/tasks endpoint with auth' } });
  }
  return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
});

export { publicRoutes };
