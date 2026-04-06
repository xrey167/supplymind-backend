import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { agentConfigs } from '../../src/infra/db/schema';

describe('Tasks', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let agentId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Tasks Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    const [agent] = await testDb.insert(agentConfigs).values({
      workspaceId,
      name: 'Task Agent',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      mode: 'raw',
    }).returning({ id: agentConfigs.id });
    agentId = agent!.id;
  });

  afterAll(async () => {
    await truncateTables('task_dependencies', 'a2a_tasks', 'agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/tasks`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let taskId: string;
  let taskId2: string;

  it('POST / sends a task and returns 201', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ agentId, message: 'Hello' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.agentId).toBe(agentId);
    expect(body.data.status).toBe('submitted');
    taskId = body.data.id;
  });

  it('GET / lists tasks with pagination', async () => {
    const res = await app.request(`${base()}?limit=10`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns task details', async () => {
    const res = await app.request(`${base()}/${taskId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(taskId);
  });

  it('POST / sends a second task for dependency tests', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ agentId, message: 'Task 2' }),
    });
    expect(res.status).toBe(201);
    taskId2 = (await res.json() as any).data.id;
  });

  it('POST /:id/dependencies adds a dependency', async () => {
    const res = await app.request(`${base()}/${taskId2}/dependencies`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ dependsOnTaskId: taskId }),
    });
    expect(res.status).toBe(201);
  });

  it('GET /:id/dependencies lists dependencies', async () => {
    const res = await app.request(`${base()}/${taskId2}/dependencies`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((d: any) => d.dependsOnTaskId === taskId)).toBe(true);
  });

  it('DELETE /:id/dependencies/:depId removes a dependency', async () => {
    const res = await app.request(`${base()}/${taskId2}/dependencies/${taskId}`, {
      method: 'DELETE',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(204);
  });

  it('POST /:id/cancel cancels the task', async () => {
    const res = await app.request(`${base()}/${taskId}/cancel`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect([200, 409]).toContain(res.status);
  });
});
