import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Workspace Settings', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Settings Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_settings', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/settings`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET /settings returns workspace settings', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.data).toBe('object');
  });

  it('PATCH /settings updates tool permission mode', async () => {
    const res = await app.request(base(), {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ toolPermissionMode: 'ask' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.toolPermissionMode).toBe('ask');
  });
});
