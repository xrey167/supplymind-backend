import { describe, it, expect, beforeAll } from 'bun:test';
import { getTestApp } from './helpers';

describe('Public endpoints', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  describe('GET /.well-known/agent.json', () => {
    it('returns A2A agent card with name and version', async () => {
      const res = await app.request('/.well-known/agent.json');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body.name).toBe('string');
      expect(typeof body.version).toBe('string');
    });
  });

  describe('POST /a2a', () => {
    it('returns 401 without Authorization header', async () => {
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: 'abc' } }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 503 when A2A_API_KEY is not configured', async () => {
      const savedKey = Bun.env.A2A_API_KEY;
      delete Bun.env.A2A_API_KEY;

      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer some-random-key' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: 'abc' } }),
      });
      expect(res.status).toBe(503);

      if (savedKey) Bun.env.A2A_API_KEY = savedKey;
    });

    it('returns 401 for wrong API key', async () => {
      Bun.env.A2A_API_KEY = 'correct-key';

      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: 'abc' } }),
      });
      expect(res.status).toBe(401);

      delete Bun.env.A2A_API_KEY;
    });

    it('returns JSON-RPC error (-32601) for unknown method', async () => {
      Bun.env.A2A_API_KEY = 'test-a2a-key';

      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-a2a-key' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown/method', params: {} }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error.code).toBe(-32601);

      delete Bun.env.A2A_API_KEY;
    });
  });
});
