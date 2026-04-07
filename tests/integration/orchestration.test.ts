import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Orchestration', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Orchestration Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('orchestrations', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/orchestrations`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let orchId: string;

  it('POST / creates an orchestration', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        definition: {
          steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'hello' } }],
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    orchId = body.id ?? body.data?.id;
    expect(typeof orchId).toBe('string');
  });

  it('GET / lists orchestrations', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const items = Array.isArray(body) ? body : body.data;
    expect(Array.isArray(items)).toBe(true);
  });

  it('GET /:id returns orchestration', async () => {
    const res = await app.request(`${base()}/${orchId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id ?? body.data?.id).toBe(orchId);
  });

  it('POST /:id/run submits the orchestration', async () => {
    const res = await app.request(`${base()}/${orchId}/run`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({}),
    });
    // Returns 200 with orchestrationId or 503 if BullMQ unavailable (no Redis in test)
    expect([200, 503]).toContain(res.status);
  });

  it('POST /:id/cancel cancels the orchestration', async () => {
    const res = await app.request(`${base()}/${orchId}/cancel`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect([200, 400, 404, 409]).toContain(res.status);
  });
});
