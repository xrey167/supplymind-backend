import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

const catalogStore = new Map<string, any>();
const installStore = new Map<string, any>();
const eventStore: any[] = [];

const _realCatalogRepo = require('../plugins.catalog.repo');
mock.module('../plugins.catalog.repo', () => ({
  ..._realCatalogRepo,
  pluginCatalogRepo: {
    findCatalogEntry: async (id: string) => catalogStore.get(id),
    listAll: async () => [...catalogStore.values()],
  },
}));

const _realInstallRepo = require('../plugins.installation.repo');
mock.module('../plugins.installation.repo', () => ({
  ..._realInstallRepo,
  pluginInstallationRepo: {
    findInstallation: async (id: string) => installStore.get(id),
    findByWorkspaceAndPlugin: async (wsId: string, pluginId: string) =>
      [...installStore.values()].find(i => i.workspaceId === wsId && i.pluginId === pluginId),
    findByWorkspace: async (wsId: string) =>
      [...installStore.values()].filter(i => i.workspaceId === wsId),
    installPlugin: async (data: any) => {
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

const _realHealthRepo = require('../plugins.health.repo');
mock.module('../plugins.health.repo', () => ({
  ..._realHealthRepo,
  pluginHealthRepo: {
    recordHealthCheck: async (data: any) => ({ id: 'health-1', ...data, checkedAt: new Date() }),
    getLatest: async () => undefined,
  },
}));

// spread to preserve FeatureFlagsService class and getAll/setFlag for tests that run after this file
const _realFF = require('../../feature-flags/feature-flags.service');
mock.module('../../feature-flags/feature-flags.service', () => ({
  ..._realFF,
  featureFlagsService: {
    isEnabled: async (_wsId: string, flag: string) => {
      if (flag === 'plugins.platform.enabled') return true;
      if (flag === 'plugins.local_sandboxed.enabled') return false;
      return true;
    },
  },
}));

// spread to preserve logger.debug and other methods for tests that run after this file
const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

// plugins.service.ts imports credentialsService (for erp-bc path); spread to keep CredentialsService class
const _realCreds = require('../../credentials/credentials.service');
mock.module('../../credentials/credentials.service', () => ({
  ..._realCreds,
  credentialsService: {
    create: mock(async () => ({ ok: true, value: { id: 'cred-1' } })),
    update: mock(async () => ({ ok: true, value: {} })),
  },
}));

// Force a fresh module load so prior test files' caches don't contaminate this one.
const _pluginsServiceModule = await import('../plugins.service?fresh=1' as unknown as string);
const pluginsService = _pluginsServiceModule.pluginsService;
const { featureFlagsService } = await import('../../feature-flags/feature-flags.service');
const { PluginConflictError } = await import('../plugins.types');

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

  it('install fails when platform flag is disabled', async () => {
    const orig = (featureFlagsService as any).isEnabled;
    (featureFlagsService as any).isEnabled = async (_wsId: string, flag: string) =>
      flag === 'plugins.platform.enabled' ? false : true;
    const result = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not enabled');
    (featureFlagsService as any).isEnabled = orig;
  });

  it('install returns helpful error for disabled existing installation', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    installStore.get(install.value.id).status = 'disabled';
    const result = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('uninstall it first');
  });

  it('enable fails when plugin is already active', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    const result = await pluginsService.enable(wsId, install.value.id, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Cannot enable plugin in status: active');
  });

  it('disable fails when plugin is already disabled', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    await pluginsService.disable(wsId, install.value.id, actor);
    const result = await pluginsService.disable(wsId, install.value.id, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Cannot disable plugin in status: disabled');
  });

  it('rollback returns PluginConflictError when no pinned version', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    installStore.get(install.value.id).status = 'disabled';
    const rollback = await pluginsService.rollback(wsId, install.value.id, actor);
    expect(rollback.ok).toBe(false);
    if (!rollback.ok) expect(rollback.error).toBeInstanceOf(PluginConflictError);
  });

  it('rollback fails when plugin is in active status', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    const result = await pluginsService.rollback(wsId, install.value.id, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Cannot rollback plugin in status: active');
  });

  it('runHealthCheck with no healthCheckUrl returns healthy for active install', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    const result = await pluginsService.runHealthCheck(wsId, install.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('healthy');
  });

  it('runHealthCheck returns degraded when installation is disabled', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    installStore.get(install.value.id).status = 'disabled';
    const result = await pluginsService.runHealthCheck(wsId, install.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('degraded');
  });

  it('runHealthCheck returns err when catalog is missing', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    catalogStore.delete('plugin-1');
    const result = await pluginsService.runHealthCheck(wsId, install.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('catalog entry not found');
  });

  it('runHealthCheck with http:// URL blocks (not https)', async () => {
    catalogStore.set('plugin-http', {
      id: 'plugin-http', name: 'HTTP Plugin', version: '1.0.0', kind: 'remote_mcp',
      capabilities: [], requiredPermissions: ['workspace:read'],
      manifest: { ...mockManifest, id: 'plugin-http', healthCheckUrl: 'http://api.example.com/health' },
    });
    const install = await pluginsService.install(wsId, 'plugin-http', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    const result = await pluginsService.runHealthCheck(wsId, install.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value.status).toBe('unreachable'); expect(result.value.error).toContain('blocked'); }
  });

  it('runHealthCheck blocks 127.0.0.1 (loopback)', async () => {
    catalogStore.set('plugin-loop', {
      id: 'plugin-loop', name: 'Loop Plugin', version: '1.0.0', kind: 'remote_mcp',
      capabilities: [], requiredPermissions: ['workspace:read'],
      manifest: { ...mockManifest, id: 'plugin-loop', healthCheckUrl: 'https://127.0.0.1/health' },
    });
    const install = await pluginsService.install(wsId, 'plugin-loop', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    const result = await pluginsService.runHealthCheck(wsId, install.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value.status).toBe('unreachable'); expect(result.value.error).toContain('blocked'); }
  });

  it('runHealthCheck blocks 10.x private range', async () => {
    catalogStore.set('plugin-priv', {
      id: 'plugin-priv', name: 'Priv Plugin', version: '1.0.0', kind: 'remote_mcp',
      capabilities: [], requiredPermissions: ['workspace:read'],
      manifest: { ...mockManifest, id: 'plugin-priv', healthCheckUrl: 'https://10.0.0.1/health' },
    });
    const install = await pluginsService.install(wsId, 'plugin-priv', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    const result = await pluginsService.runHealthCheck(wsId, install.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.error).toContain('blocked');
  });

  it('runHealthCheck blocks fc00:: IPv6 ULA', async () => {
    catalogStore.set('plugin-ula', {
      id: 'plugin-ula', name: 'ULA Plugin', version: '1.0.0', kind: 'remote_mcp',
      capabilities: [], requiredPermissions: ['workspace:read'],
      manifest: { ...mockManifest, id: 'plugin-ula', healthCheckUrl: 'https://[fc00::1]/health' },
    });
    const install = await pluginsService.install(wsId, 'plugin-ula', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    const result = await pluginsService.runHealthCheck(wsId, install.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.error).toContain('blocked');
  });
});

afterAll(() => mock.restore());
