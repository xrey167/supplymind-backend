import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  },
}));

const _realSentry = require('../../../infra/observability/sentry');
mock.module('../../../infra/observability/sentry', () => ({
  ..._realSentry,
  captureException: mock(() => {}),
  setUser: mock(() => {}),
  initSentry: mock(() => {}),
  Sentry: {},
}));

mock.module('../../../infra/auth/api-key', () => ({
  validateApiKey: mock(async (token: string) => {
    if (token.startsWith('a2a_k_')) {
      return { role: 'admin', workspaceId: 'ws-test', name: 'test-key' };
    }
    return null;
  }),
  hashApiKey: mock(async (key: string) => {
    const hash = new Bun.CryptoHasher('sha256');
    hash.update(key);
    return hash.digest('hex');
  }),
  createApiKey: mock(async () => ({ token: 'a2a_k_mock', keyInfo: {} })),
}));

const { authMiddleware } = await import('../auth');
const { errorHandler } = await import('../error-handler');

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', authMiddleware);
  app.get('/test', (c) =>
    c.json({ callerId: (c as any).get('callerId'), callerRole: (c as any).get('callerRole') }),
  );
  return app;
}

// Helper: build a minimal unsigned JWT-shaped token (base64url encoded)
function makeDevJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.fakesig`;
}

describe('authMiddleware', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  describe('when Authorization header is missing', () => {
    it('should return 401', async () => {
      const res = await app.request('/test');
      expect(res.status).toBe(401);
    });

    it('should return error body with UNAUTHORIZED code', async () => {
      const res = await app.request('/test');
      const body = await res.json();
      expect(body.error.message).toContain('Authorization');
    });
  });

  describe('when Authorization header does not start with Bearer', () => {
    it('should return 401', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Basic abc123' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('API key auth (token starting with a2a_k_)', () => {
    it('should set callerId with apikey: prefix', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer a2a_k_mykey12345' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.callerId).toMatch(/^apikey:/);
    });

    it('should set callerRole to admin', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer a2a_k_mykey12345' },
      });
      const body = await res.json();
      expect(body.callerRole).toBe('admin');
    });

    it('should include a truncated token representation in callerId', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer a2a_k_mykey12345' },
      });
      const body = await res.json();
      // callerId is: apikey:<first 12 chars of token>...
      expect(body.callerId).toBe('apikey:a2a_k_mykey1...');
    });
  });

  describe('JWT auth (dev-mode fallback — no CLERK_SECRET_KEY)', () => {
    it('should set callerId from payload.sub', async () => {
      const token = makeDevJwt({ sub: 'user-abc', role: 'viewer' });
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.callerId).toBe('user-abc');
    });

    it('should set callerRole from payload.role', async () => {
      const token = makeDevJwt({ sub: 'user-abc', role: 'editor' });
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      expect(body.callerRole).toBe('editor');
    });

    it('should fall back to viewer callerRole when role is absent', async () => {
      const token = makeDevJwt({ sub: 'user-abc' });
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      expect(body.callerRole).toBe('viewer');
    });

    it('should fall back to dev-user callerId when sub is absent', async () => {
      const token = makeDevJwt({ role: 'viewer' });
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      expect(body.callerId).toBe('dev-user');
    });

    it('should return 401 for a malformed token (not 3 parts)', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer notajwt' },
      });
      expect(res.status).toBe(401);
    });

    it('should return 401 for a token with invalid base64 payload', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer header.!!!.sig' },
      });
      expect(res.status).toBe(401);
    });

    it('should read callerRole from payload.metadata.role when top-level role absent', async () => {
      const token = makeDevJwt({ sub: 'user-xyz', metadata: { role: 'operator' } });
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      expect(body.callerRole).toBe('operator');
    });

    it('should handle base64url-encoded JWT payloads with special characters', async () => {
      // Manually build a JWT with base64url chars (- and _) in the payload
      const payload = { sub: 'user-with-special+/chars', role: 'admin' };
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${header}.${body}.fakesig`;

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.callerId).toBe('user-with-special+/chars');
    });
  });
});

const { requireRole } = await import('../auth');

describe('requireRole middleware', () => {

  function buildProtectedApp(minimumRole: string) {
    const app = new Hono();
    app.onError(errorHandler);
    app.use('*', authMiddleware);
    app.get('/protected', requireRole(minimumRole as any), (c) => c.json({ ok: true }));
    return app;
  }

  it('should allow access when caller role meets requirement', async () => {
    const app = buildProtectedApp('operator');
    const token = makeDevJwt({ sub: 'user-1', role: 'admin' });
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('should deny access when caller role is insufficient', async () => {
    const app = buildProtectedApp('admin');
    const token = makeDevJwt({ sub: 'user-1', role: 'viewer' });
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('should allow exact role match', async () => {
    const app = buildProtectedApp('operator');
    const token = makeDevJwt({ sub: 'user-1', role: 'operator' });
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

afterAll(() => mock.restore());
