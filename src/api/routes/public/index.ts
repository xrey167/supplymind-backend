import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { buildAgentCard } from '../../../infra/a2a/agent-card';
import { execute, resolveAuth } from '../../../core/gateway';
import type { GatewayContext } from '../../../core/gateway';

const publicRoutes = new OpenAPIHono();

// Agent Card discovery (no auth required per A2A spec)
const agentCardRoute = createRoute({
  method: 'get',
  path: '/.well-known/agent.json',
  responses: { 200: { description: 'A2A Agent Card', content: { 'application/json': { schema: z.object({}).passthrough() } } } },
});

publicRoutes.openapi(agentCardRoute, (c) => {
  return c.json(buildAgentCard());
});

// JSON-RPC 2.0 envelope validation
const jsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const tasksSendParamsSchema = z.object({
  id: z.string().optional(),
  agentId: z.string().optional(),
  message: z.unknown().optional(),
  text: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// A2A JSON-RPC endpoint — requires API key auth
publicRoutes.post('/a2a', async (c) => {
  // Auth: require Bearer token
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Missing or invalid Authorization header. Use Bearer <api-key>.' } }, 401);
  }

  const token = authHeader.slice(7);

  // Try gateway auth first (a2a_k_ workspace keys, JWTs), then fall back to shared A2A_API_KEY
  let context: GatewayContext;
  const identity = await resolveAuth(token);
  if (identity) {
    context = {
      callerId: identity.callerId,
      workspaceId: identity.workspaceId,
      callerRole: identity.callerRole,
    };
  } else {
    // Fallback: shared A2A_API_KEY for external agents without workspace keys
    const configuredKey = Bun.env.A2A_API_KEY;
    if (!configuredKey) {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'A2A endpoint not configured (missing A2A_API_KEY)' } }, 503);
    }
    // Constant-time comparison to prevent timing side-channel attacks
    const keyBuf = Buffer.from(token);
    const confBuf = Buffer.from(configuredKey);
    const keysMatch = keyBuf.length === confBuf.length &&
      crypto.timingSafeEqual(keyBuf, confBuf);
    if (!keysMatch) {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Invalid API key' } }, 401);
    }
    context = { callerId: 'a2a', workspaceId: 'public', callerRole: 'operator' };
  }

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
    const result = await execute({ op: 'task.get', params: { id }, context });
    if (!result.ok) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: result.error.message } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: result.value });
  }

  if (body.method === 'tasks/cancel') {
    const id = (body.params as any)?.id;
    if (typeof id !== 'string') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params: id must be a string' } }, 400);
    }
    const result = await execute({ op: 'task.cancel', params: { id }, context });
    if (!result.ok) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: result.error.message } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: result.value });
  }

  if (body.method === 'tasks/send') {
    const parseResult = tasksSendParamsSchema.safeParse(body.params ?? {});
    if (!parseResult.success) {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: `Invalid params: ${parseResult.error.message}` } }, 400);
    }
    const params = parseResult.data;
    const agentId = params.agentId ?? 'default';
    const messageText = typeof params.message === 'string'
      ? params.message
      : params.text ?? '';

    const result = await execute({
      op: 'task.send',
      params: { agentId, message: messageText },
      context,
    });

    if (!result.ok) {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: result.error.message } });
    }
    return c.json({ jsonrpc: '2.0', id: body.id, result: result.value });
  }

  return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
});

export { publicRoutes };
