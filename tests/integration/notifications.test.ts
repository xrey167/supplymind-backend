import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { notifications } from '../../src/infra/db/schema';

describe('Notifications', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Notifications Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    // Seed a notification directly
    await testDb.insert(notifications).values({
      workspaceId,
      userId,
      type: 'task_error',
      title: 'Task failed',
      body: 'Task xyz encountered an error',
      channel: 'in_app',
      status: 'pending',
    });
  });

  afterAll(async () => {
    await truncateTables('notifications', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/notifications`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET / lists notifications', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].title).toBe('Task failed');
  });

  it('GET /unread-count returns count', async () => {
    const res = await app.request(`${base()}/unread-count`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.count).toBeGreaterThanOrEqual(1);
  });

  it('POST /{id}/read marks notification as read', async () => {
    // Get a notification ID first
    const listRes = await app.request(base(), { headers: hdrs() });
    const list = await listRes.json() as any;
    const id = list.data[0].id;

    const res = await app.request(`${base()}/${id}/read`, {
      method: 'POST',
      headers: hdrs(),
    });
    expect(res.status).toBe(200);
  });

  it('POST /read-all marks all as read', async () => {
    const res = await app.request(`${base()}/read-all`, {
      method: 'POST',
      headers: hdrs(),
    });
    expect(res.status).toBe(200);

    // Verify count is 0
    const countRes = await app.request(`${base()}/unread-count`, { headers: hdrs() });
    const body = await countRes.json() as any;
    expect(body.data.count).toBe(0);
  });
});
