import { describe, it, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { rateLimit, _resetBuckets } from '../rate-limit';

function createApp(maxRequests: number) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as any).set('workspaceId', 'ws-test');
    return next();
  });
  app.use('*', rateLimit(maxRequests));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  beforeEach(() => _resetBuckets());

  it('allows requests under the limit', async () => {
    const app = createApp(5);
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('returns 429 when limit exceeded', async () => {
    const app = createApp(3);
    await app.request('/test');
    await app.request('/test');
    await app.request('/test');
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    const body = await res.json() as any;
    expect(body.error).toBe('Too many requests');
  });

  it('sets rate limit headers', async () => {
    const app = createApp(10);
    const res = await app.request('/test');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
  });

  it('includes Retry-After header on 429', async () => {
    const app = createApp(1);
    await app.request('/test');
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
