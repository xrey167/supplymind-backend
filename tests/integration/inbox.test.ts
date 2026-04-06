import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { inboxItems } from '../../src/infra/db/schema';

describe('Inbox', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let itemId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Inbox Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    // Seed inbox items
    const [item] = await testDb.insert(inboxItems).values([
      { workspaceId, type: 'task_completed', title: 'Task done', body: 'Agent finished', metadata: {} },
      { workspaceId, type: 'member_joined', title: 'New member', body: 'Alice joined', metadata: {} },
    ]).returning();
    itemId = item!.id;
  });

  afterAll(async () => {
    await truncateTables('inbox_items', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/inbox`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET / lists inbox items', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBe(2);
  });

  it('POST /{id}/read marks item as read', async () => {
    const res = await app.request(`${base()}/${itemId}/read`, {
      method: 'POST',
      headers: hdrs(),
    });
    expect(res.status).toBe(200);
  });

  it('POST /{id}/pin toggles pin status', async () => {
    const res = await app.request(`${base()}/${itemId}/pin`, {
      method: 'POST',
      headers: hdrs(),
    });
    expect(res.status).toBe(200);
  });

  it('GET /unread-count returns count', async () => {
    const res = await app.request(`${base()}/unread-count`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.data.count).toBe('number');
  });

  it('POST /read-all marks all as read', async () => {
    const res = await app.request(`${base()}/read-all`, {
      method: 'POST',
      headers: hdrs(),
    });
    expect(res.status).toBe(200);
  });
});
