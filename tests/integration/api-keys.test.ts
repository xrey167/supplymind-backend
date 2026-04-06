import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('API Keys', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'API Keys Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('api_keys', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/api-keys`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let keyId: string;
  let rawToken: string;

  it('POST / creates an API key and returns token', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ name: 'CI Key', role: 'operator' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    // Response: { token, key: { id, name, role, ... } }
    rawToken = body.token;
    keyId = body.key.id;
    expect(rawToken.startsWith('a2a_k_')).toBe(true);
  });

  it('GET / lists API keys', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((k: any) => k.id === keyId)).toBe(true);
  });

  it('GET /:keyId returns key details', async () => {
    const res = await app.request(`${base()}/${keyId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(keyId);
  });

  it('created API key can authenticate workspace requests', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/agents?workspaceId=${workspaceId}`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('POST /:keyId/revoke revokes the API key', async () => {
    const res = await app.request(`${base()}/${keyId}/revoke`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.revoked).toBe(true);
  });

  it('revoked key returns 401', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/agents?workspaceId=${workspaceId}`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /:keyId deletes the API key', async () => {
    // Create a fresh key to delete
    const createRes = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ name: 'Delete Me Key', role: 'viewer' }),
    });
    const deleteKeyId = (await createRes.json() as any).key.id;

    const res = await app.request(`${base()}/${deleteKeyId}`, {
      method: 'DELETE',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });
});
