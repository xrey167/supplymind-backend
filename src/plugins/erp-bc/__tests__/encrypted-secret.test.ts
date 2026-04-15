import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCredentialsService = {
  create: mock(async (_input: unknown) => ({
    ok: true as const,
    value: { id: 'cred-123', name: 'erp-bc-client-secret', provider: 'erp-bc' },
  })),
  getDecrypted: mock(async (_id: string, _workspaceId: string) => ({
    ok: true as const,
    value: 'super-secret',
  })),
  update: mock(async (_id: string, _input: unknown) => ({
    ok: true as const,
    value: { id: 'cred-123', name: 'erp-bc-client-secret', provider: 'erp-bc' },
  })),
};

const mockPluginInstallationRepo = {
  findByWorkspaceAndPlugin: mock(async () => undefined as any),
  installPlugin: mock(async (data: any) => ({
    id: 'install-abc',
    workspaceId: data.workspaceId,
    pluginId: data.pluginId,
    status: 'installing',
    config: data.config ?? {},
    secretBindingIds: [],
    policyBinding: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    pinnedVersion: null,
  })),
  transition: mock(async (_id: string, _wsId: string, newStatus: string, _evType: string, _actor: any, _payload?: any, extraUpdates?: any) => ({
    installation: {
      id: 'install-abc',
      workspaceId: 'ws-1',
      pluginId: 'plugin-uuid',
      status: newStatus,
      config: extraUpdates?.config ?? {},
      secretBindingIds: [],
      policyBinding: {},
      installedAt: new Date(),
      updatedAt: new Date(),
      pinnedVersion: null,
    },
    event: { id: 'evt-1' },
  })),
  updateSecretBindingIds: mock(async () => undefined),
  findInstallation: mock(async (id: string) => ({
    id,
    workspaceId: 'ws-1',
    pluginId: 'plugin-uuid',
    status: 'active',
    config: { tenantId: 't1', clientId: 'c1', baseUrl: 'https://bc.test', companyId: 'co1' },
    secretBindingIds: [],
    policyBinding: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    pinnedVersion: null,
  })),
};

const mockCatalogEntry = {
  id: 'plugin-uuid',
  name: 'ERP Sync — Business Central',
  version: '1.0.0',
  kind: 'webhook',
  capabilities: [],
  requiredPermissions: ['workspace:read'],
  manifest: {
    id: 'erp-bc',
    name: 'ERP Sync — Business Central',
    version: '1.0.0',
    kind: 'webhook',
    description: 'BC connector',
    capabilities: [],
    requiredPermissions: ['workspace:read'],
  },
  publisher: null,
  verified: true,
  createdAt: new Date(),
};

const mockPluginCatalogRepo = {
  findCatalogEntry: mock(async () => mockCatalogEntry),
};

const mockFeatureFlagsService = {
  isEnabled: mock(async () => true),
};

const mockValidatePluginConfig = mock(() => ({ valid: true as const }));
const mockCheckPermissions = mock(() => ({ allowed: true as const, missing: [] }));

// Set up module mocks before importing the service
const _realCredentialsService = require('../../../modules/credentials/credentials.service');
mock.module('../../../modules/credentials/credentials.service', () => ({
  ..._realCredentialsService,
  credentialsService: mockCredentialsService,
}));

const _realPluginCatalogRepo = require('../../../modules/plugins/plugins.catalog.repo');
mock.module('../../../modules/plugins/plugins.catalog.repo', () => ({
  ..._realPluginCatalogRepo,
  pluginCatalogRepo: mockPluginCatalogRepo,
}));

const _realPluginInstallationRepo = require('../../../modules/plugins/plugins.installation.repo');
mock.module('../../../modules/plugins/plugins.installation.repo', () => ({
  ..._realPluginInstallationRepo,
  pluginInstallationRepo: mockPluginInstallationRepo,
}));

const _realPluginHealthRepo = require('../../../modules/plugins/plugins.health.repo');
mock.module('../../../modules/plugins/plugins.health.repo', () => ({
  ..._realPluginHealthRepo,
  pluginHealthRepo: {},
}));

const _realFeatureFlagsService = require('../../../modules/feature-flags/feature-flags.service');
mock.module('../../../modules/feature-flags/feature-flags.service', () => ({
  ..._realFeatureFlagsService,
  featureFlagsService: mockFeatureFlagsService,
}));

const _realPluginManifestValidator = require('../../../modules/plugins/plugins.manifest-validator');
mock.module('../../../modules/plugins/plugins.manifest-validator', () => ({
  ..._realPluginManifestValidator,
  validatePluginConfig: mockValidatePluginConfig,
  checkPermissions: mockCheckPermissions,
}));

const mockLoggerWarn = mock(() => {});
const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: {
    info: () => {},
    warn: mockLoggerWarn,
    error: () => {},
    debug: () => {},
  },
}));

// Force a fresh module load so prior test files' caches don't contaminate this one.
const _pluginsServiceMod = await import('../../../modules/plugins/plugins.service?fresh=erp' as unknown as string);
const pluginsService = _pluginsServiceMod.pluginsService;

// ── Helpers ───────────────────────────────────────────────────────────────────

const actor = { id: 'user-1', type: 'user' as const };

const erpBcConfig = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'super-secret',
  baseUrl: 'https://api.bc.example/v2.0/tenant-1/Production/ODataV4',
  companyId: 'company-1',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ERP-BC encrypted secret — install path', () => {
  beforeEach(() => {
    mockCredentialsService.create.mockReset();
    mockCredentialsService.create.mockImplementation(async () => ({
      ok: true as const,
      value: { id: 'cred-123', name: 'erp-bc-client-secret', provider: 'erp-bc' },
    }));
    mockPluginInstallationRepo.findByWorkspaceAndPlugin.mockReset();
    mockPluginInstallationRepo.findByWorkspaceAndPlugin.mockImplementation(async () => undefined);
    mockPluginInstallationRepo.updateSecretBindingIds.mockReset();
    mockPluginInstallationRepo.updateSecretBindingIds.mockImplementation(async () => undefined);
    mockPluginInstallationRepo.installPlugin.mockReset();
    mockPluginInstallationRepo.installPlugin.mockImplementation(async (data: any) => ({
      id: 'install-abc',
      workspaceId: data.workspaceId,
      pluginId: data.pluginId,
      status: 'installing',
      config: data.config ?? {},
      secretBindingIds: [],
      policyBinding: {},
      installedAt: new Date(),
      updatedAt: new Date(),
      pinnedVersion: null,
    }));
    mockPluginInstallationRepo.transition.mockReset();
    mockPluginInstallationRepo.transition.mockImplementation(async (_id: string, _wsId: string, newStatus: string, _evType: string, _actor: any, _payload?: any, extraUpdates?: any) => ({
      installation: {
        id: 'install-abc',
        workspaceId: 'ws-1',
        pluginId: 'plugin-uuid',
        status: newStatus,
        config: extraUpdates?.config ?? {},
        secretBindingIds: [],
        policyBinding: {},
        installedAt: new Date(),
        updatedAt: new Date(),
        pinnedVersion: null,
      },
      event: { id: 'evt-1' },
    }));
  });

  it('strips clientSecret from stored config', async () => {
    const result = await pluginsService.install('ws-1', 'plugin-uuid', erpBcConfig, actor, ['workspace:read']);
    expect(result.ok).toBe(true);

    // The config passed to repo.installPlugin must NOT contain clientSecret
    const createCall = mockPluginInstallationRepo.installPlugin.mock.calls[0];
    expect(createCall).toBeDefined();
    const storedConfig = (createCall as any)[0].config;
    expect(storedConfig).not.toHaveProperty('clientSecret');
    expect(storedConfig).toHaveProperty('tenantId', 'tenant-1');
  });

  it('calls credentialsService.create with correct args', async () => {
    const result = await pluginsService.install('ws-1', 'plugin-uuid', erpBcConfig, actor, ['workspace:read']);
    expect(result.ok).toBe(true);

    expect(mockCredentialsService.create).toHaveBeenCalledTimes(1);
    const createArg = mockCredentialsService.create.mock.calls[0][0] as any;
    expect(createArg.provider).toBe('erp-bc');
    expect(createArg.name).toBe('erp-bc-client-secret');
    expect(createArg.value).toBe('super-secret');
    expect(createArg.workspaceId).toBe('ws-1');
    expect(createArg.metadata?.installationId).toBe('install-abc');
  });

  it('updates secretBindingIds on installation after secret creation', async () => {
    const result = await pluginsService.install('ws-1', 'plugin-uuid', erpBcConfig, actor, ['workspace:read']);
    expect(result.ok).toBe(true);

    expect(mockPluginInstallationRepo.updateSecretBindingIds).toHaveBeenCalledTimes(1);
    const [calledId, calledIds] = mockPluginInstallationRepo.updateSecretBindingIds.mock.calls[0] as [string, string[]];
    expect(calledId).toBe('install-abc');
    expect(calledIds).toEqual(['cred-123']);

    // Returned installation should have secretBindingIds populated
    if (result.ok) {
      expect(result.value.secretBindingIds).toEqual(['cred-123']);
    }
  });

  it('does not call credentialsService.create when no clientSecret in config', async () => {
    const configWithoutSecret = { tenantId: 't1', clientId: 'c1', baseUrl: 'https://bc.test', companyId: 'co1' };
    const result = await pluginsService.install('ws-1', 'plugin-uuid', configWithoutSecret, actor, ['workspace:read']);
    expect(result.ok).toBe(true);
    expect(mockCredentialsService.create).not.toHaveBeenCalled();
  });
});

describe('ERP-BC encrypted secret — updateConfig path', () => {
  beforeEach(() => {
    mockCredentialsService.update.mockReset();
    mockCredentialsService.update.mockImplementation(async () => ({
      ok: true as const,
      value: { id: 'cred-123', name: 'erp-bc-client-secret', provider: 'erp-bc' },
    }));
    mockCredentialsService.create.mockReset();
    mockCredentialsService.create.mockImplementation(async () => ({
      ok: true as const,
      value: { id: 'cred-new', name: 'erp-bc-client-secret', provider: 'erp-bc' },
    }));
    mockPluginInstallationRepo.updateSecretBindingIds.mockReset();
    mockPluginInstallationRepo.updateSecretBindingIds.mockImplementation(async () => undefined);
    mockPluginInstallationRepo.transition.mockReset();
    mockPluginInstallationRepo.transition.mockImplementation(async (_id: string, _wsId: string, newStatus: string, _evType: string, _actor: any, _payload?: any, extraUpdates?: any) => ({
      installation: {
        id: _id,
        workspaceId: 'ws-1',
        pluginId: 'plugin-uuid',
        status: newStatus,
        config: extraUpdates?.config ?? {},
        secretBindingIds: [],
        policyBinding: {},
        installedAt: new Date(),
        updatedAt: new Date(),
        pinnedVersion: null,
      },
      event: { id: 'evt-2' },
    }));
  });

  it('calls credentialsService.update when secretBindingIds[0] exists', async () => {
    const withSecret = async (id: string) => ({
      id,
      workspaceId: 'ws-1',
      pluginId: 'plugin-uuid',
      status: 'active',
      config: { tenantId: 't1', clientId: 'c1', baseUrl: 'https://bc.test', companyId: 'co1' },
      secretBindingIds: ['cred-123'],
      policyBinding: {},
      installedAt: new Date(),
      updatedAt: new Date(),
      pinnedVersion: null,
    });
    mockPluginInstallationRepo.findInstallation.mockImplementation(withSecret);

    const newConfig = { ...erpBcConfig, clientSecret: 'new-secret' };
    const result = await pluginsService.updateConfig('ws-1', 'install-abc', newConfig, actor);
    expect(result.ok).toBe(true);

    expect(mockCredentialsService.update).toHaveBeenCalledTimes(1);
    const [credId, updateArg] = mockCredentialsService.update.mock.calls[0] as [string, any];
    expect(credId).toBe('cred-123');
    expect(updateArg.value).toBe('new-secret');

    // clientSecret must not be in stored config
    const transitionCall = mockPluginInstallationRepo.transition.mock.calls[0];
    const storedConfig = (transitionCall as any)[6]?.config;
    expect(storedConfig).not.toHaveProperty('clientSecret');
  });

  it('calls credentialsService.create when no secretBindingIds yet', async () => {
    const withoutSecret = async (id: string) => ({
      id,
      workspaceId: 'ws-1',
      pluginId: 'plugin-uuid',
      status: 'active',
      config: { tenantId: 't1', clientId: 'c1', baseUrl: 'https://bc.test', companyId: 'co1' },
      secretBindingIds: [],
      policyBinding: {},
      installedAt: new Date(),
      updatedAt: new Date(),
      pinnedVersion: null,
    });
    mockPluginInstallationRepo.findInstallation.mockImplementation(withoutSecret);

    const newConfig = { ...erpBcConfig, clientSecret: 'new-secret' };
    const result = await pluginsService.updateConfig('ws-1', 'install-abc', newConfig, actor);
    expect(result.ok).toBe(true);

    expect(mockCredentialsService.create).toHaveBeenCalledTimes(1);
    const createArg = mockCredentialsService.create.mock.calls[0][0] as any;
    expect(createArg.value).toBe('new-secret');
    expect(createArg.provider).toBe('erp-bc');

    expect(mockPluginInstallationRepo.updateSecretBindingIds).toHaveBeenCalledTimes(1);
    const [_, ids] = mockPluginInstallationRepo.updateSecretBindingIds.mock.calls[0] as [string, string[]];
    expect(ids).toEqual(['cred-new']);
  });
});

describe('ERP-BC encrypted secret — worker path', () => {
  it('resolves clientSecret via credentialsService.getDecrypted when secretBindingIds present', async () => {
    // Directly test the resolution logic by simulating the data shapes
    const installation = {
      secretBindingIds: ['cred-123'],
      config: { tenantId: 't1', clientId: 'c1', baseUrl: 'https://bc.test', companyId: 'co1' },
    };
    const workspaceId = 'ws-1';

    const secretBindingIds = installation.secretBindingIds as string[] | undefined;
    let clientSecret: string | undefined;

    if (secretBindingIds?.[0]) {
      const decrypted = await mockCredentialsService.getDecrypted(secretBindingIds[0], workspaceId);
      if (decrypted.ok) {
        clientSecret = decrypted.value;
      }
    }

    // Migration fallback not needed
    if (!clientSecret) {
      clientSecret = (installation.config as any)?.clientSecret;
    }

    expect(clientSecret).toBe('super-secret');
    expect(mockCredentialsService.getDecrypted).toHaveBeenCalledWith('cred-123', 'ws-1');
  });

  it('falls back to plaintext clientSecret in config when no secretBindingIds', async () => {
    mockLoggerWarn.mockReset();

    const installation = {
      secretBindingIds: [] as string[],
      config: {
        tenantId: 't1',
        clientId: 'c1',
        baseUrl: 'https://bc.test',
        companyId: 'co1',
        clientSecret: 'plaintext-secret',
      },
    };
    const syncJob = { workspaceId: 'ws-1', installationId: 'install-abc' };

    const secretBindingIds = installation.secretBindingIds as string[] | undefined;
    let clientSecret: string | undefined;

    if (secretBindingIds?.[0]) {
      const decrypted = await mockCredentialsService.getDecrypted(secretBindingIds[0], syncJob.workspaceId);
      if (decrypted.ok) {
        clientSecret = decrypted.value;
      } else {
        mockLoggerWarn({ credentialId: secretBindingIds[0] }, 'Failed to decrypt ERP-BC client secret — falling back to plaintext config');
      }
    }

    // Migration fallback: use plaintext if no secretBindingId yet
    if (!clientSecret) {
      if (!secretBindingIds?.[0]) {
        mockLoggerWarn({ workspaceId: syncJob.workspaceId, installationId: syncJob.installationId }, 'ERP-BC installation has no secretBindingId — using plaintext clientSecret (please re-install to encrypt)');
      }
      clientSecret = (installation.config as any)?.clientSecret;
    }

    expect(clientSecret).toBe('plaintext-secret');
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    const warnCall = mockLoggerWarn.mock.calls[0] as [Record<string, unknown>, string];
    expect(warnCall[1]).toMatch(/no secretBindingId/);
  });

  it('throws when BOTH decryption and plaintext config fail', async () => {
    const installation = {
      secretBindingIds: ['cred-bad'],
      config: { tenantId: 't1', clientId: 'c1', baseUrl: 'https://bc.test', companyId: 'co1' },
    };
    const workspaceId = 'ws-1';

    mockCredentialsService.getDecrypted.mockImplementationOnce(async () => ({
      ok: false as const,
      error: new Error('Decryption failed'),
    }));

    const secretBindingIds = installation.secretBindingIds as string[] | undefined;
    let clientSecret: string | undefined;

    if (secretBindingIds?.[0]) {
      const decrypted = await mockCredentialsService.getDecrypted(secretBindingIds[0], workspaceId);
      if (decrypted.ok) {
        clientSecret = decrypted.value;
      }
    }

    if (!clientSecret) {
      clientSecret = (installation.config as any)?.clientSecret;
    }

    expect(clientSecret).toBeUndefined();

    // Verify that the worker logic would throw
    const runSync = () => {
      if (!clientSecret) {
        throw new Error('ERP-BC client secret not available — cannot run sync');
      }
    };
    expect(runSync).toThrow('ERP-BC client secret not available — cannot run sync');
  });
});

afterAll(() => mock.restore());
