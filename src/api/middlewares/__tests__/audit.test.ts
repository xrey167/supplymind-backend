import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock eventBus before importing audit middleware
const mockPublish = mock(() => Promise.resolve({} as any));
mock.module('../../../events/bus', () => ({
  eventBus: { publish: mockPublish },
}));
mock.module('../../../config/logger', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}));

const { Hono } = await import('hono');
const { auditMiddleware } = await import('../audit');

describe('auditMiddleware', () => {
  beforeEach(() => {
    mockPublish.mockReset();
    mockPublish.mockResolvedValue({} as any);
  });

  it('publishes audit event on request', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('callerId', 'user-1');
      c.set('workspaceId', 'ws-1');
      return next();
    });
    app.use('*', auditMiddleware);
    app.get('/test', (c) => c.json({ ok: true }));

    await app.request('/test');

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, data] = mockPublish.mock.calls[0];
    expect(topic).toBe('audit.request');
    expect(data.method).toBe('GET');
    expect(data.path).toBe('/test');
    expect(data.callerId).toBe('user-1');
    expect(data.workspaceId).toBe('ws-1');
    expect(data.status).toBe(200);
    expect(typeof data.durationMs).toBe('number');
  });

  it('uses anonymous/none when no auth context', async () => {
    const app = new Hono();
    app.use('*', auditMiddleware);
    app.get('/public', (c) => c.json({ ok: true }));

    await app.request('/public');

    const [, data] = mockPublish.mock.calls[0];
    expect(data.callerId).toBe('anonymous');
    expect(data.workspaceId).toBe('none');
  });
});
