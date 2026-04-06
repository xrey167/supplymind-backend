import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { eventBus } from '../../../events/bus';
import { auditMiddleware } from '../audit';

const mockPublish = spyOn(eventBus, 'publish').mockResolvedValue({} as any);

afterAll(() => { mockPublish.mockRestore(); });

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
