import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { buildAgentCard } from '../../../infra/a2a/agent-card';
import { taskManager } from '../../../infra/a2a/task-manager';

const publicRoutes = new OpenAPIHono();

// Agent Card discovery (no auth required per A2A spec)
publicRoutes.get('/.well-known/agent.json', (c) => {
  return c.json(buildAgentCard());
});

// JSON-RPC 2.0 envelope validation
const jsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

const tasksSendParamsSchema = z.object({
  id: z.string().optional(),
  agentId: z.string().optional(),
  message: z.unknown().optional(),
  text: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// A2A JSON-RPC endpoint — requires API key auth
publicRoutes.post('/a2a', async (c) => {
  // Auth: require Bearer token
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Missing or invalid Authorization header. Use Bearer <api-key>.' } }, 401);
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith('a2a_k_') && !apiKey.startsWith('ey')) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Invalid API key format' } }, 401);
  }
  // TODO: validate API key against DB when api_keys table is available

  // Parse and validate JSON-RPC envelope
  let body: z.infer<typeof jsonRpcSchema>;
  try {
    const raw = await c.req.json();
    body = jsonRpcSchema.parse(raw);
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON-RPC request' } }, 400);
  }

  // Dispatch based on method
  if (body.method === 'tasks/get') {
    const id = (body.params as any)?.id;
    if (typeof id !== 'string') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params: id must be a string' } }, 400);
    }
    const task = taskManager.get(id);
    if (!task) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Task not found' } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: task });
  }

  if (body.method === 'tasks/cancel') {
    const id = (body.params as any)?.id;
    if (typeof id !== 'string') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params: id must be a string' } }, 400);
    }
    const task = taskManager.cancel(id);
    if (!task) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Task not found' } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: task });
  }

  if (body.method === 'tasks/send') {
    const parseResult = tasksSendParamsSchema.safeParse(body.params ?? {});
    if (!parseResult.success) {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: `Invalid params: ${parseResult.error.message}` } }, 400);
    }
    const params = parseResult.data;
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
