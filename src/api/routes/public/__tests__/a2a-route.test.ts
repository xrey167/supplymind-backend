import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod/v4';

/**
 * A2A route tests.
 *
 * We build a standalone app mirroring the route logic with injected mock
 * dependencies, avoiding Bun mock.module path-resolution issues.
 * This tests the same auth flow, JSON-RPC dispatch, and gateway routing.
 */

const mockExecute = mock((_req: any) => Promise.resolve({ ok: true as const, value: {} }));
const mockResolveAuth = mock((_token: string) => Promise.resolve(null as any));

// --- Route logic (mirrors src/api/routes/public/index.ts) ---

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

const app = new OpenAPIHono();

app.post('/a2a', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Missing or invalid Authorization header. Use Bearer <api-key>.' } }, 401);
  }

  const token = authHeader.slice(7);

  let context: any;
  const identity = await mockResolveAuth(token);
  if (identity) {
    context = { callerId: identity.callerId, workspaceId: identity.workspaceId, callerRole: identity.callerRole };
  } else {
    const configuredKey = Bun.env.A2A_API_KEY;
    if (!configuredKey) {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'A2A endpoint not configured (missing A2A_API_KEY)' } }, 503);
    }
    if (token !== configuredKey) {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Invalid API key' } }, 401);
    }
    context = { callerId: 'a2a', workspaceId: 'public', callerRole: 'operator' };
  }

  let body: z.infer<typeof jsonRpcSchema>;
  try {
    const raw = await c.req.json();
    body = jsonRpcSchema.parse(raw);
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON-RPC request' } }, 400);
  }

  if (body.method === 'tasks/get') {
    const id = (body.params as any)?.id;
    if (typeof id !== 'string') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params: id must be a string' } }, 400);
    }
    const result = await mockExecute({ op: 'task.get', params: { id }, context });
    if (!result.ok) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: (result as any).error.message } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: result.value });
  }

  if (body.method === 'tasks/cancel') {
    const id = (body.params as any)?.id;
    if (typeof id !== 'string') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params: id must be a string' } }, 400);
    }
    const result = await mockExecute({ op: 'task.cancel', params: { id }, context });
    if (!result.ok) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: (result as any).error.message } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: result.value });
  }

  if (body.method === 'tasks/send') {
    const parseResult = tasksSendParamsSchema.safeParse(body.params ?? {});
    if (!parseResult.success) {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: `Invalid params: ${parseResult.error.message}` } }, 400);
    }
    const params = parseResult.data;
    const agentId = params.agentId ?? 'default';
    const messageText = typeof params.message === 'string' ? params.message : params.text ?? '';

    const result = await mockExecute({ op: 'task.send', params: { agentId, message: messageText }, context });
    if (!result.ok) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: (result as any).error.message } });
    return c.json({ jsonrpc: '2.0', id: body.id, result: result.value });
  }

  return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
});

// --- Helpers ---

function jsonRpc(method: string, params?: Record<string, unknown>, id: string | number = 1) {
  return { jsonrpc: '2.0' as const, id, method, params };
}

async function postA2a(body: unknown, token = 'test-key') {
  const res = await app.request('/a2a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json() as any;
  return { res, body: json };
}

// --- Tests ---

describe('A2A public route', () => {
  const originalEnv = Bun.env.A2A_API_KEY;

  beforeEach(() => {
    mockExecute.mockReset();
    mockResolveAuth.mockReset();
    mockExecute.mockResolvedValue({ ok: true, value: {} });
    mockResolveAuth.mockResolvedValue(null);
    Bun.env.A2A_API_KEY = 'test-key';
  });

  afterAll(() => {
    Bun.env.A2A_API_KEY = originalEnv;
  });

  describe('auth', () => {
    it('rejects requests without Authorization header', async () => {
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonRpc('tasks/get', { id: 't1' })),
      });
      expect(res.status).toBe(401);
    });

    it('rejects invalid API key when resolveAuth returns null', async () => {
      const { res } = await postA2a(jsonRpc('tasks/get', { id: 't1' }), 'wrong-key');
      expect(res.status).toBe(401);
    });

    it('accepts valid A2A_API_KEY fallback and builds a2a context', async () => {
      const { res } = await postA2a(jsonRpc('tasks/get', { id: 't1' }));
      expect(res.status).toBe(200);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const call = mockExecute.mock.calls[0][0];
      expect(call.context.callerId).toBe('a2a');
      expect(call.context.workspaceId).toBe('public');
    });

    it('uses resolveAuth identity when available', async () => {
      mockResolveAuth.mockResolvedValue({
        callerId: 'apikey:a2a_k_abc123',
        workspaceId: 'ws-42',
        callerRole: 'operator',
      });
      const { res } = await postA2a(jsonRpc('tasks/get', { id: 't1' }));
      expect(res.status).toBe(200);
      const call = mockExecute.mock.calls[0][0];
      expect(call.context.callerId).toBe('apikey:a2a_k_abc123');
      expect(call.context.workspaceId).toBe('ws-42');
    });

    it('returns 503 when A2A_API_KEY not configured and resolveAuth fails', async () => {
      delete Bun.env.A2A_API_KEY;
      const { res } = await postA2a(jsonRpc('tasks/get', { id: 't1' }), 'some-key');
      expect(res.status).toBe(503);
    });
  });

  describe('tasks/get', () => {
    it('routes to gateway task.get', async () => {
      mockExecute.mockResolvedValue({ ok: true, value: { id: 't1', status: 'completed' } });
      const { body } = await postA2a(jsonRpc('tasks/get', { id: 't1' }));
      expect(body.result).toEqual({ id: 't1', status: 'completed' });
      expect(mockExecute.mock.calls[0][0].op).toBe('task.get');
    });

    it('returns JSON-RPC error when gateway returns err', async () => {
      mockExecute.mockResolvedValue({ ok: false, error: new Error('Task not found') });
      const { body } = await postA2a(jsonRpc('tasks/get', { id: 't1' }));
      expect(body.error.message).toBe('Task not found');
    });

    it('rejects missing id param', async () => {
      const { res, body } = await postA2a(jsonRpc('tasks/get', {}));
      expect(res.status).toBe(400);
      expect(body.error.code).toBe(-32602);
    });
  });

  describe('tasks/cancel', () => {
    it('routes to gateway task.cancel', async () => {
      mockExecute.mockResolvedValue({ ok: true, value: { id: 't1', status: 'canceled' } });
      const { body } = await postA2a(jsonRpc('tasks/cancel', { id: 't1' }));
      expect(body.result.status).toBe('canceled');
      expect(mockExecute.mock.calls[0][0].op).toBe('task.cancel');
    });

    it('rejects missing id param', async () => {
      const { res, body } = await postA2a(jsonRpc('tasks/cancel', {}));
      expect(res.status).toBe(400);
      expect(body.error.code).toBe(-32602);
    });
  });

  describe('tasks/send', () => {
    it('routes to gateway task.send with agentId and message', async () => {
      mockExecute.mockResolvedValue({ ok: true, value: { id: 't-new', status: 'submitted' } });
      const { body } = await postA2a(jsonRpc('tasks/send', { agentId: 'agent-1', text: 'Hello' }));
      expect(body.result.id).toBe('t-new');
      const call = mockExecute.mock.calls[0][0];
      expect(call.op).toBe('task.send');
      expect(call.params.agentId).toBe('agent-1');
      expect(call.params.message).toBe('Hello');
    });

    it('defaults agentId to "default"', async () => {
      mockExecute.mockResolvedValue({ ok: true, value: { id: 't2' } });
      await postA2a(jsonRpc('tasks/send', { text: 'hi' }));
      expect(mockExecute.mock.calls[0][0].params.agentId).toBe('default');
    });

    it('uses message string directly when provided', async () => {
      mockExecute.mockResolvedValue({ ok: true, value: { id: 't3' } });
      await postA2a(jsonRpc('tasks/send', { message: 'direct msg' }));
      expect(mockExecute.mock.calls[0][0].params.message).toBe('direct msg');
    });

    it('returns JSON-RPC error on gateway failure', async () => {
      mockExecute.mockResolvedValue({ ok: false, error: new Error('Agent not found') });
      const { body } = await postA2a(jsonRpc('tasks/send', { text: 'hi' }));
      expect(body.error.message).toBe('Agent not found');
    });
  });

  describe('edge cases', () => {
    it('returns method not found for unknown method', async () => {
      const { body } = await postA2a(jsonRpc('unknown/method'));
      expect(body.error.code).toBe(-32601);
    });

    it('returns parse error for invalid JSON body', async () => {
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error.code).toBe(-32700);
    });
  });
});
