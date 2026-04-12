import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

function createTestApp() {
  const app = new Hono();
  app.use('*', secureHeaders({
    contentSecurityPolicy: false as any,
    crossOriginEmbedderPolicy: false,
    xFrameOptions: 'DENY',
    strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    referrerPolicy: 'strict-origin-when-cross-origin',
  }));
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  return app;
}

describe('security headers and CORS', () => {
  it('sets security headers on responses', async () => {
    const app = createTestApp();
    const res = await app.request('/healthz');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('includes HSTS header', async () => {
    const app = createTestApp();
    const res = await app.request('/healthz');
    const hsts = res.headers.get('Strict-Transport-Security');
    expect(hsts).toContain('max-age=');
  });

  it('does not set Content-Security-Policy (JSON API)', async () => {
    const app = createTestApp();
    const res = await app.request('/healthz');
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });
});
