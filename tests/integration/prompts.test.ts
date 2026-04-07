import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Prompts', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let promptId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Prompts Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('prompts', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/prompts`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('POST / creates a prompt template', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        name: 'Summarize',
        content: 'Summarize the following: {{text}}',
        description: 'Summarization template',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Summarize');
    expect(body.data.variables.map((v: any) => v.name ?? v)).toContain('text');
    promptId = body.data.id;
  });

  it('GET / lists prompt templates', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /{id} returns single prompt', async () => {
    const res = await app.request(`${base()}/${promptId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(promptId);
  });

  it('POST /{id}/render renders template with variables', async () => {
    const res = await app.request(`${base()}/${promptId}/render`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ variables: { text: 'Hello world' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.rendered).toContain('Hello world');
  });

  it('PATCH /{id} updates prompt', async () => {
    const res = await app.request(`${base()}/${promptId}`, {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ name: 'Updated Summarize' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Updated Summarize');
  });

  it('DELETE /{id} removes prompt', async () => {
    const res = await app.request(`${base()}/${promptId}`, {
      method: 'DELETE',
      headers: hdrs(),
    });
    expect(res.status).toBe(200);

    const getRes = await app.request(`${base()}/${promptId}`, { headers: hdrs() });
    expect(getRes.status).toBe(404);
  });
});
