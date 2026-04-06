import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Workflows', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Workflows Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workflow_templates', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/workflows`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let workflowId: string;

  it('POST / creates a workflow template', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        name: 'Test Workflow',
        definition: {
          steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: {} }],
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    workflowId = body.data.id;
    expect(body.data.name).toBe('Test Workflow');
  });

  it('GET / lists workflow templates', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(workflowId);
  });

  it('PATCH /:id updates a workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}`, {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ name: 'Updated Workflow' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Updated Workflow');
  });

  it('POST /run runs an ad-hoc workflow', async () => {
    const res = await app.request(`${base()}/run`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        definition: {
          steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'test' } }],
        },
      }),
    });
    expect([200, 202]).toContain(res.status);
  });

  it('POST /:id/run runs a saved workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}/run`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({}),
    });
    expect([200, 202]).toContain(res.status);
  });

  it('DELETE /:id deletes a workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}`, {
      method: 'DELETE',
      headers: hdrs(),
    });
    expect(res.status).toBe(204);
  });
});
