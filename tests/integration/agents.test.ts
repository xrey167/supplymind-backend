import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Agents', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Agents Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/agents`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let agentId: string;

  it('POST / creates an agent', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        workspaceId,
        name: 'Test Agent',
        model: 'claude-opus-4-6',
        provider: 'anthropic',
        mode: 'raw',
        systemPrompt: 'You are a test agent.',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Test Agent');
    agentId = body.data.id;
  });

  it('GET / lists agents for workspace', async () => {
    const res = await app.request(`${base()}?workspaceId=${workspaceId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns agent by id', async () => {
    const res = await app.request(`${base()}/${agentId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(agentId);
  });

  it('PATCH /:id updates an agent', async () => {
    const res = await app.request(`${base()}/${agentId}`, {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ name: 'Updated Agent' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Updated Agent');
  });

  it('DELETE /:id deletes an agent', async () => {
    const res = await app.request(`${base()}/${agentId}`, {
      method: 'DELETE',
      headers: hdrs(),
    });
    expect(res.status).toBe(204);
  });

  it('GET /:id returns 404 for deleted agent', async () => {
    const res = await app.request(`${base()}/${agentId}`, { headers: hdrs() });
    expect(res.status).toBe(404);
  });

  it('GET / returns 403 when user is not a workspace member', async () => {
    const res = await app.request(`${base()}?workspaceId=${workspaceId}`, {
      headers: authHeader('user_outsider', 'admin'),
    });
    expect(res.status).toBe(403);
  });
});
