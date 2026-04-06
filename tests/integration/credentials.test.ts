import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Credentials', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let createdId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Credentials Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
    // Ensure encryption key is set for tests
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-master-key-for-integration-32b';
  });

  afterAll(async () => {
    await truncateTables('credentials', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/credentials`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('POST / creates a credential', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        name: 'Anthropic API Key',
        provider: 'anthropic',
        value: 'sk-ant-test-secret-key',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Anthropic API Key');
    expect(body.data.provider).toBe('anthropic');
    expect(body.data.encryptedValue).toBeUndefined();
    createdId = body.data.id;
  });

  it('GET / lists credentials without secrets', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].encryptedValue).toBeUndefined();
  });

  it('GET /{id} returns single credential', async () => {
    const res = await app.request(`${base()}/${createdId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(createdId);
    expect(body.data.name).toBe('Anthropic API Key');
  });

  it('PATCH /{id} updates credential name', async () => {
    const res = await app.request(`${base()}/${createdId}`, {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ name: 'Renamed Key' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Renamed Key');
  });

  it('DELETE /{id} removes credential', async () => {
    const res = await app.request(`${base()}/${createdId}`, {
      method: 'DELETE',
      headers: hdrs(),
    });
    expect(res.status).toBe(200);

    // Verify it's gone
    const getRes = await app.request(`${base()}/${createdId}`, { headers: hdrs() });
    expect(getRes.status).toBe(404);
  });
});
