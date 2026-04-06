import { describe, it, expect, beforeAll } from 'bun:test';
import { getTestApp } from './helpers';

describe('GET /healthz', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it('returns 200 with status ok', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('GET /readyz', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it('returns a status field (200 when DB reachable, 503 otherwise)', async () => {
    const res = await app.request('/readyz');
    expect([200, 503]).toContain(res.status);
    const body = await res.json() as any;
    expect(typeof body.status).toBe('string');
  });
});
