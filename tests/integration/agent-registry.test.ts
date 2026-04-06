import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Agent Registry', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Registry Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('registered_agents', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/agent-registry`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let registeredAgentId: string;

  it('POST / registers an A2A agent', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ url: 'http://localhost:9999/a2a' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    registeredAgentId = body.data.id;
    expect(typeof registeredAgentId).toBe('string');
  });

  it('GET / lists registered agents', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((a: any) => a.id === registeredAgentId)).toBe(true);
  });

  it('DELETE /:agentId removes a registered agent', async () => {
    const res = await app.request(`${base()}/${registeredAgentId}`, {
      method: 'DELETE',
      headers: hdrs(),
    });
    expect(res.status).toBe(204);
  });
});
