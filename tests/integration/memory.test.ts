import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { agentConfigs } from '../../src/infra/db/schema';

describe('Memory', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let agentId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Memory Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    const [agent] = await testDb.insert(agentConfigs).values({
      workspaceId,
      name: 'Memory Agent',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      mode: 'raw',
    }).returning({ id: agentConfigs.id });
    agentId = agent!.id;
  });

  afterAll(async () => {
    await truncateTables('memory_proposals', 'agent_memories', 'agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/memory`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let memoryId: string;

  it('POST / saves a memory', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        agentId,
        type: 'domain',
        title: 'Test memory',
        content: 'The user prefers concise answers.',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    memoryId = body.id ?? body.data?.id;
    expect(typeof memoryId).toBe('string');
  });

  it('GET / lists memories for workspace', async () => {
    const res = await app.request(`${base()}?agentId=${agentId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json() as any).data;
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /recall recalls relevant memories', async () => {
    const res = await app.request(`${base()}/recall`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ query: 'concise answers', agentId, limit: 5 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json() as any).data;
    expect(Array.isArray(body)).toBe(true);
  });

  it('DELETE /:id forgets a memory', async () => {
    const res = await app.request(`${base()}/${memoryId}`, {
      method: 'DELETE',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(204);
  });

  it('POST /proposals proposes a memory and approve it', async () => {
    const propRes = await app.request(`${base()}/proposals`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        agentId,
        type: 'feedback',
        title: 'Use bullet points',
        content: 'Remember to always use bullet points.',
      }),
    });
    expect(propRes.status).toBe(201);
    const prop = await propRes.json() as any;
    const proposalId = prop.id ?? prop.data?.id;
    expect(typeof proposalId).toBe('string');

    const approveRes = await app.request(`${base()}/proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(approveRes.status).toBe(200);
  });
});
