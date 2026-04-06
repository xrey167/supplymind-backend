import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, truncateTables, closeTestDb } from './helpers';

const BASE = '/api/v1/workspace-management';

describe('Workspace management', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  const userId = 'user_ws_integration';

  beforeAll(async () => {
    app = await getTestApp();
    await truncateTables('workspace_members', 'workspaces', 'users');
  });

  afterAll(async () => {
    await truncateTables('workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  it('POST / creates a workspace and returns 201', async () => {
    const res = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'Integration WS' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Integration WS');
    expect(typeof body.data.id).toBe('string');
  });

  it('GET / lists workspaces for the user', async () => {
    const res = await app.request(`${BASE}/`, {
      headers: authHeader(userId),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /:workspaceId returns workspace details', async () => {
    const createRes = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Detail Test' }),
    });
    const { data: ws } = await createRes.json() as any;

    const res = await app.request(`${BASE}/${ws.id}`, {
      headers: authHeader(userId),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(ws.id);
  });

  it('PATCH /:workspaceId updates workspace name', async () => {
    const createRes = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Rename Me' }),
    });
    const { data: ws } = await createRes.json() as any;

    const res = await app.request(`${BASE}/${ws.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Renamed' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('WS Renamed');
  });

  it('DELETE /:workspaceId soft-deletes the workspace', async () => {
    const createRes = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Delete Me' }),
    });
    const { data: ws } = await createRes.json() as any;

    const res = await app.request(`${BASE}/${ws.id}`, {
      method: 'DELETE',
      headers: authHeader(userId),
    });
    expect(res.status).toBe(204);
  });

  it('POST / returns 401 without auth', async () => {
    const res = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth WS' }),
    });
    expect(res.status).toBe(401);
  });
});
