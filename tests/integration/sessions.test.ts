import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { agentConfigs } from '../../src/infra/db/schema';

describe('Sessions', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let agentId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Sessions Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    const [agent] = await testDb.insert(agentConfigs).values({
      workspaceId,
      name: 'Session Agent',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      mode: 'raw',
    }).returning({ id: agentConfigs.id });
    agentId = agent!.id;
  });

  afterAll(async () => {
    await truncateTables('session_messages', 'sessions', 'agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/sessions`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let sessionId: string;

  it('POST / creates a session', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ agentId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.agentId ?? body.data?.agentId).toBe(agentId);
    sessionId = body.id ?? body.data?.id;
    expect(typeof sessionId).toBe('string');
  });

  it('GET /:id returns session details', async () => {
    const res = await app.request(`${base()}/${sessionId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id ?? body.data?.id).toBe(sessionId);
  });

  it('POST /:id/messages adds a message', async () => {
    const res = await app.request(`${base()}/${sessionId}/messages`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ role: 'user', content: 'Hello world' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.content ?? body.data?.content).toBe('Hello world');
  });

  it('GET /:id/messages returns messages', async () => {
    const res = await app.request(`${base()}/${sessionId}/messages`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const msgs = Array.isArray(body) ? body : body.data;
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /:id/close closes the session', async () => {
    const res = await app.request(`${base()}/${sessionId}/close`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect([200, 204]).toContain(res.status);
  });
});
