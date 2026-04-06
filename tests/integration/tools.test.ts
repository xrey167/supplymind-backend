import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Tools', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Tools Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('skill_definitions', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/tools`;
  // workspace owner maps to 'admin' system role via mapWorkspaceRole; tools require 'operator'
  // mapWorkspaceRole('owner') -> 'admin', 'admin' -> 'operator' — check rbac chain
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let toolId: string;

  it('POST / creates a tool', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        name: 'test-tool',
        description: 'A test tool',
        workspaceId,
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        handlerConfig: { type: 'inline', code: 'return args.query' },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('test-tool');
    toolId = body.data.id;
  });

  it('GET / lists tools', async () => {
    const res = await app.request(`${base()}?workspaceId=${workspaceId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns tool by id', async () => {
    const res = await app.request(`${base()}/${toolId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(toolId);
  });

  it('PATCH /:id updates a tool', async () => {
    const res = await app.request(`${base()}/${toolId}`, {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ description: 'Updated description' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.description).toBe('Updated description');
  });

  it('DELETE /:id deletes a tool', async () => {
    const res = await app.request(`${base()}/${toolId}`, {
      method: 'DELETE',
      headers: hdrs(),
    });
    expect(res.status).toBe(204);
  });
});
