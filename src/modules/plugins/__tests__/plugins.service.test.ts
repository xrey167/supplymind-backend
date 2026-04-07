import { describe, it, expect, mock, beforeEach } from 'bun:test';

const catalogStore = new Map<string, any>();
const installStore = new Map<string, any>();
const eventStore: any[] = [];

mock.module('../plugins.catalog.repo', () => ({
  pluginCatalogRepo: {
    findById: async (id: string) => catalogStore.get(id),
    findAll: async () => [...catalogStore.values()],
  },
}));

mock.module('../plugins.installation.repo', () => ({
  pluginInstallationRepo: {
    findById: async (id: string) => installStore.get(id),
    findByWorkspaceAndPlugin: async (wsId: string, pluginId: string) =>
      [...installStore.values()].find(i => i.workspaceId === wsId && i.pluginId === pluginId),
    findByWorkspace: async (wsId: string) =>
      [...installStore.values()].filter(i => i.workspaceId === wsId),
    create: async (data: any) => {
      const row = { id: `inst-${Math.random()}`, ...data, status: 'installing', installedAt: new Date(), updatedAt: new Date() };
      installStore.set(row.id, row);
      return row;
    },
    transition: async (id: string, wsId: string, newStatus: string, eventType: string, actor: any, payload = {}, extras = {}) => {
      const inst = installStore.get(id);
      if (!inst) throw new Error('not found');
      Object.assign(inst, { status: newStatus, updatedAt: new Date(), ...extras });
      const event = { id: `evt-${Math.random()}`, installationId: id, workspaceId: wsId, eventType, actorId: actor.id, actorType: actor.type, payload, createdAt: new Date() };
      eventStore.push(event);
      return { installation: inst, event };
    },
    getEvents: async (id: string) => eventStore.filter(e => e.installationId === id),
    getLastVersionPinnedEvent: async (id: string) =>
      [...eventStore].reverse().find(e => e.installationId === id && e.eventType === 'version_pinned'),
  },
}));

mock.module('../plugins.health.repo', () => ({
  pluginHealthRepo: {
    create: async (data: any) => ({ id: 'health-1', ...data, checkedAt: new Date() }),
    getLatest: async () => undefined,
  },
}));

mock.module('../../feature-flags/feature-flags.service', () => ({
  featureFlagsService: {
    isEnabled: async (_wsId: string, flag: string) => {
      if (flag === 'plugins.platform.enabled') return true;
      if (flag === 'plugins.local_sandboxed.enabled') return false;
      return true;
    },
  },
}));

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { pluginsService } = await import('../plugins.service');

const actor = { id: 'user-1', type: 'user' as const };
const wsId = 'ws-test';

const mockManifest = {
  id: 'test-plugin', name: 'Test Plugin', version: '1.0.0',
  kind: 'remote_mcp' as const, description: 'test',
  capabilities: [], requiredPermissions: ['workspace:read'],
};

beforeEach(() => {
  catalogStore.clear();
  installStore.clear();
  eventStore.length = 0;
  catalogStore.set('plugin-1', {
    id: 'plugin-1', name: 'Test Plugin', version: '1.0.0', kind: 'remote_mcp',
    capabilities: [], requiredPermissions: ['workspace:read'],
    manifest: mockManifest,
  });
});

describe('pluginsService', () => {
  it('install creates installation and transitions to active', async () => {
    const result = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('active');
    }
    const events = eventStore.filter(e => e.eventType === 'installed');
    expect(events).toHaveLength(1);
  });

  it('install blocks local_sandboxed when flag off', async () => {
    catalogStore.set('sandbox-1', {
      id: 'sandbox-1', name: 'Sandbox Plugin', version: '1.0.0', kind: 'local_sandboxed',
      capabilities: [], requiredPermissions: ['workspace:read', 'local_sandboxed:run'],
      manifest: { ...mockManifest, kind: 'local_sandboxed' },
    });
    const result = await pluginsService.install(wsId, 'sandbox-1', {}, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('local_sandboxed');
  });

  it('install fails with missing permission', async () => {
    catalogStore.set('restricted-1', {
      id: 'restricted-1', name: 'Restricted Plugin', version: '1.0.0', kind: 'remote_mcp',
      capabilities: [], requiredPermissions: ['erp:write'],
      manifest: { ...mockManifest, requiredPermissions: ['erp:write'] },
    });
    const result = await pluginsService.install(wsId, 'restricted-1', {}, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('erp:write');
  });

  it('disable transitions active → disabled', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;

    const disable = await pluginsService.disable(wsId, install.value.id, actor);
    expect(disable.ok).toBe(true);
    if (disable.ok) expect(disable.value.status).toBe('disabled');
  });

  it('enable transitions disabled → active', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    await pluginsService.disable(wsId, install.value.id, actor);

    const enable = await pluginsService.enable(wsId, install.value.id, actor);
    expect(enable.ok).toBe(true);
    if (enable.ok) expect(enable.value.status).toBe('active');
  });

  it('rollback fails when no pinned version exists', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    installStore.get(install.value.id).status = 'disabled';

    const rollback = await pluginsService.rollback(wsId, install.value.id, actor);
    expect(rollback.ok).toBe(false);
    if (!rollback.ok) expect(rollback.error.message).toContain('No pinned version');
  });

  it('rollback succeeds after pinning a version', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;

    await pluginsService.pinVersion(wsId, install.value.id, '1.0.0', actor);
    installStore.get(install.value.id).status = 'disabled';

    const rollback = await pluginsService.rollback(wsId, install.value.id, actor);
    expect(rollback.ok).toBe(true);
    if (rollback.ok) expect(rollback.value.status).toBe('active');
  });
});
