import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Feature Flags', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Feature Flags Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_settings', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/feature-flags`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET /feature-flags lists all flags with defaults', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body).toBe('object');
    expect('computer-use.enabled' in body).toBe(true);
    expect('agent.max-iterations' in body).toBe(true);
  });

  it('PATCH /feature-flags sets a flag value', async () => {
    const res = await app.request(base(), {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ flag: 'computer-use.enabled', value: true }),
    });
    expect(res.status).toBe(200);

    const getRes = await app.request(base(), { headers: hdrs() });
    const body = await getRes.json() as any;
    expect(body['computer-use.enabled']).toBe(true);
  });
});
