import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('MCP Servers', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'MCP Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('mcp_server_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/mcp`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let mcpId: string;

  it('POST / creates an MCP server config', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        name: 'Test MCP Server',
        transport: 'stdio',
        command: 'echo',
        args: ['hello'],
        enabled: false,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Test MCP Server');
    mcpId = body.data.id;
  });

  it('GET / lists MCP servers for workspace', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((s: any) => s.id === mcpId)).toBe(true);
  });

  it('PATCH /:mcpId updates an MCP server config', async () => {
    const res = await app.request(`${base()}/${mcpId}`, {
      method: 'PATCH',
      headers: hdrs(),
      body: JSON.stringify({ name: 'Updated MCP Server' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Updated MCP Server');
  });

  it('DELETE /:mcpId deletes the MCP server config', async () => {
    const res = await app.request(`${base()}/${mcpId}`, {
      method: 'DELETE',
      headers: hdrs(),
    });
    expect(res.status).toBe(204);
  });
});
