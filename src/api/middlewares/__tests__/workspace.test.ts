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

// Mock DB — tests don't hit a real database
let mockMemberRows: { role: string }[] = [];
const _realDbClient2 = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient2,
  db: {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve(mockMemberRows)),
        })),
      })),
    })),
  },
}));

const { workspaceMiddleware } = await import('../workspace');
const { errorHandler } = await import('../error-handler');

// App that reads workspaceId from a route param
function buildParamApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/ws/:workspaceId/*', workspaceMiddleware);
  app.get('/ws/:workspaceId/data', (c) =>
    c.json({ workspaceId: (c as any).get('workspaceId') }),
  );
  return app;
}

// App that relies on X-Workspace-Id header (no param)
function buildHeaderApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/data', workspaceMiddleware);
  app.get('/data', (c) => c.json({ workspaceId: (c as any).get('workspaceId') }));
  return app;
}

describe('workspaceMiddleware', () => {
  beforeEach(() => {
    mockMemberRows = [];
  });
  describe('when workspaceId is absent from both param and header', () => {
    it('should return 403', async () => {
      const app = buildHeaderApp();
      const res = await app.request('/data');
      expect(res.status).toBe(403);
    });

    it('should include a descriptive error message', async () => {
      const app = buildHeaderApp();
      const res = await app.request('/data');
      const body = await res.json();
      expect(body.error.message).toContain('workspace');
    });
  });

  describe('when workspaceId is provided via route param', () => {
    it('should set workspaceId context and return 200', async () => {
      const app = buildParamApp();
      const res = await app.request('/ws/ws-123/data');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspaceId).toBe('ws-123');
    });

    it('should pass through without error for API key callers', async () => {
      const app = new Hono();
      app.use('/ws/:workspaceId/*', async (c, next) => {
        (c as any).set('callerId', 'apikey:a2a_k_abc...');
        await next();
      });
      app.use('/ws/:workspaceId/*', workspaceMiddleware);
      app.get('/ws/:workspaceId/data', (c) =>
        c.json({ workspaceId: (c as any).get('workspaceId') }),
      );
      const res = await app.request('/ws/ws-456/data');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspaceId).toBe('ws-456');
    });
  });

  describe('when workspaceId is provided via X-Workspace-Id header', () => {
    it('should set workspaceId context and return 200', async () => {
      const app = buildHeaderApp();
      const res = await app.request('/data', {
        headers: { 'X-Workspace-Id': 'ws-header-999' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspaceId).toBe('ws-header-999');
    });
  });

  describe('when both param and header are provided', () => {
    it('should prefer the route param over the header', async () => {
      const app = buildParamApp();
      const res = await app.request('/ws/ws-param/data', {
        headers: { 'X-Workspace-Id': 'ws-header' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspaceId).toBe('ws-param');
    });
  });

  describe('membership enforcement for regular callers', () => {
    it('should return 403 when user is not a member of the workspace', async () => {
      // mockDbSelect returns [] by default — no membership found
      const app = new Hono();
      app.onError(errorHandler);
      app.use('/ws/:workspaceId/*', async (c, next) => {
        (c as any).set('callerId', 'user-regular-123');
        await next();
      });
      app.use('/ws/:workspaceId/*', workspaceMiddleware);
      app.get('/ws/:workspaceId/data', (c) =>
        c.json({ workspaceId: (c as any).get('workspaceId') }),
      );
      const res = await app.request('/ws/ws-789/data');
      expect(res.status).toBe(403);
    });

    it('should allow access when user is a member', async () => {
      mockMemberRows = [{ role: 'member' }];
      const app = new Hono();
      app.onError(errorHandler);
      app.use('/ws/:workspaceId/*', async (c, next) => {
        (c as any).set('callerId', 'user-member-456');
        await next();
      });
      app.use('/ws/:workspaceId/*', workspaceMiddleware);
      app.get('/ws/:workspaceId/data', (c) =>
        c.json({ workspaceId: (c as any).get('workspaceId'), role: (c as any).get('callerRole') }),
      );
      const res = await app.request('/ws/ws-789/data');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe('operator'); // 'member' maps to 'operator' via mapWorkspaceRole
    });
  });
});

afterAll(() => mock.restore());
