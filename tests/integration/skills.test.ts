import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Skills', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Skills Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/skills`;
  const hdrs = () => ({ ...authHeader(userId, 'admin') });

  it('GET / lists available skills', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:name returns 404 for unknown skill', async () => {
    const res = await app.request(`${base()}/definitely-not-a-real-skill-xyz`, {
      headers: hdrs(),
    });
    expect(res.status).toBe(404);
  });

  it('POST /:name/invoke returns 400 or 404 for unknown skill', async () => {
    const res = await app.request(`${base()}/nonexistent/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hdrs() },
      body: JSON.stringify({ args: {} }),
    });
    expect([400, 404]).toContain(res.status);
  });

  it('GET /:name describes a known builtin skill (if any registered)', async () => {
    const listRes = await app.request(base(), { headers: hdrs() });
    const { data: skills } = await listRes.json() as any;
    if (skills.length === 0) return;

    const skillName = skills[0].name as string;
    const res = await app.request(`${base()}/${skillName}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe(skillName);
  });
});
