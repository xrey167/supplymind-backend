import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { workspaceMembers, users } from '../../src/infra/db/schema';

describe('Members', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let ownerId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Members Test WS' });
    workspaceId = seed.workspaceId;
    ownerId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_invitations', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/members`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(ownerId, 'admin') });

  it('GET /members lists members', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((m: any) => m.userId === ownerId)).toBe(true);
  });

  it('POST /members/invitations creates an invitation', async () => {
    const res = await app.request(`${base()}/invitations`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email: 'invite@example.com', role: 'member' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.invitation.email).toBe('invite@example.com');
    expect(typeof body.data.token).toBe('string');
  });

  it('GET /members/invitations lists pending invitations', async () => {
    const res = await app.request(`${base()}/invitations`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('DELETE /members/invitations/:id revokes an invitation', async () => {
    const createRes = await app.request(`${base()}/invitations`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email: 'revoke@example.com', role: 'member' }),
    });
    const { data } = await createRes.json() as any;
    const inv = data.invitation;

    const res = await app.request(`${base()}/invitations/${inv.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });

  it('PATCH /members/:userId/role updates a member role', async () => {
    const memberId = `user_member_${Date.now()}`;
    await testDb.insert(users).values({ id: memberId, email: `${memberId}@test.com` }).onConflictDoNothing();
    await testDb.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member' });

    const res = await app.request(`${base()}/${memberId}/role`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /members/:userId removes a member', async () => {
    const memberId = `user_remove_${Date.now()}`;
    await testDb.insert(users).values({ id: memberId, email: `${memberId}@test.com` }).onConflictDoNothing();
    await testDb.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member' });

    const res = await app.request(`${base()}/${memberId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });
});
