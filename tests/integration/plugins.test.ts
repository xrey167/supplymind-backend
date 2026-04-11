import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables } from './helpers';
import { testDb } from './helpers/db';
import { pluginCatalog } from '../../src/infra/db/schema/index';

describe('Plugin Platform', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let catalogPluginId: string;
  let installationId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Plugin Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    // Seed a plugin into catalog
    const [row] = await testDb.insert(pluginCatalog).values({
      name: 'test-remote-mcp',
      version: '1.0.0',
      kind: 'remote_mcp',
      capabilities: [{ id: 'mcp_tool' }],
      requiredPermissions: ['workspace:read'],
      manifest: {
        id: 'test-remote-mcp', name: 'Test MCP Plugin', version: '1.0.0',
        kind: 'remote_mcp', description: 'Integration test plugin',
        capabilities: [], requiredPermissions: ['workspace:read'],
      },
    }).returning({ id: pluginCatalog.id });
    catalogPluginId = row!.id;

    // Enable plugin platform for this workspace (PATCH, not PUT)
    await app.request(`/api/v1/workspaces/${workspaceId}/feature-flags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId, 'admin') },
      body: JSON.stringify({ flag: 'plugins.platform.enabled', value: true }),
    });
  });

  afterAll(async () => {
    await truncateTables('plugin_health_checks', 'plugin_events', 'plugin_installations', 'plugin_catalog', 'workspace_members', 'workspaces', 'users');
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/plugins`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET /plugin-catalog returns catalog list', async () => {
    const res = await app.request('/api/v1/plugin-catalog', { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((p: any) => p.id === catalogPluginId)).toBe(true);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await app.request(`${base()}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: catalogPluginId, config: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /plugins/install creates installation (status: active)', async () => {
    const res = await app.request(`${base()}/install`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ pluginId: catalogPluginId, config: {} }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
    installationId = body.id;
    expect(typeof installationId).toBe('string');
  });

  it('GET /plugins lists installed plugins', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((i: any) => i.id === installationId)).toBe(true);
  });

  it('GET /plugins/:id returns installation', async () => {
    const res = await app.request(`${base()}/${installationId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(installationId);
  });

  it('POST /plugins/:id/disable → disabled', async () => {
    const res = await app.request(`${base()}/${installationId}/disable`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('disabled');
  });

  it('cross-workspace: disable from other workspace returns 400/404', async () => {
    const other = await seedWorkspace({ name: 'Other WS Disable' });
    await app.request(`/api/v1/workspaces/${other.workspaceId}/feature-flags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(other.userId, 'admin') },
      body: JSON.stringify({ flag: 'plugins.platform.enabled', value: true }),
    });
    const res = await app.request(`/api/v1/workspaces/${other.workspaceId}/plugins/${installationId}/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(other.userId, 'admin') },
    });
    expect([400, 404]).toContain(res.status);
  });

  it('POST /plugins/:id/enable → active', async () => {
    const res = await app.request(`${base()}/${installationId}/enable`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
  });

  it('cross-workspace: uninstall from other workspace returns 400/404', async () => {
    const other = await seedWorkspace({ name: 'Other WS Uninstall' });
    await app.request(`/api/v1/workspaces/${other.workspaceId}/feature-flags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(other.userId, 'admin') },
      body: JSON.stringify({ flag: 'plugins.platform.enabled', value: true }),
    });
    const res = await app.request(`/api/v1/workspaces/${other.workspaceId}/plugins/${installationId}/uninstall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(other.userId, 'admin') },
    });
    expect([400, 404]).toContain(res.status);
  });

  it('POST /plugins/:id/pin → version pinned', async () => {
    const res = await app.request(`${base()}/${installationId}/pin`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ version: '1.0.0' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pinnedVersion).toBe('1.0.0');
  });

  it('GET /plugins/:id/events returns event log', async () => {
    const res = await app.request(`${base()}/${installationId}/events`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);
  });

  it('POST /plugins/:id/rollback restores pinned version', async () => {
    await app.request(`${base()}/${installationId}/disable`, { method: 'POST', headers: hdrs() });
    const res = await app.request(`${base()}/${installationId}/rollback`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
  });

  it('POST /plugins/:id/rollback returns 409 when no pinned version exists', async () => {
    // Fresh install with no version pinned, then disable it to allow rollback attempt
    const [freshRow] = await testDb.insert(pluginCatalog).values({
      name: 'rollback-test-plugin',
      version: '1.0.0',
      kind: 'remote_mcp',
      capabilities: [],
      requiredPermissions: ['workspace:read'],
      manifest: {
        id: 'rollback-test-plugin', name: 'Rollback Test', version: '1.0.0',
        kind: 'remote_mcp', description: 'Rollback test plugin',
        capabilities: [], requiredPermissions: ['workspace:read'],
      },
    }).returning({ id: pluginCatalog.id });
    const freshPluginId = freshRow!.id;

    const installRes = await app.request(`${base()}/install`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ pluginId: freshPluginId, config: {} }),
    });
    expect(installRes.status).toBe(201);
    const freshInstId = (await installRes.json() as any).id;

    await app.request(`${base()}/${freshInstId}/disable`, { method: 'POST', headers: hdrs() });

    const rollbackRes = await app.request(`${base()}/${freshInstId}/rollback`, {
      method: 'POST', headers: hdrs(),
    });
    expect(rollbackRes.status).toBe(409);
  });

  it('POST /plugins/:id/uninstall → 204', async () => {
    const res = await app.request(`${base()}/${installationId}/uninstall`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(204);
  });

  it('cross-workspace GET access rejected', async () => {
    const other = await seedWorkspace({ name: 'Other WS' });
    const res = await app.request(`/api/v1/workspaces/${other.workspaceId}/plugins/${installationId}`, {
      headers: { ...authHeader(other.userId, 'admin') },
    });
    expect([404, 403]).toContain(res.status);
  });
});
