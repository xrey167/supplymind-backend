import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { PluginManifest } from '../plugin-manifest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateProfile = mock(async (_wid: string, _input: unknown) =>
  ({ ok: true, value: { id: 'profile-1', name: 'SC Executor' } }),
);
const mockRemoveProfile = mock(async (_id: string) => ({ ok: true, value: undefined }));

const mockRegisterGate   = mock((_wid: string, _pattern: string, _level: string) => undefined);
const mockUnregisterGate = mock((_wid: string, _pattern: string) => undefined);

// Minimal stubs to satisfy PluginManager.install() without hitting real DB
mock.module('../../../modules/skills/skills.registry', () => ({
  skillRegistry: { register: mock(() => undefined), unregister: mock(() => undefined) },
}));
mock.module('../../result', () => ({ ok: (v: unknown) => ({ ok: true, value: v }) }));
mock.module('../../../core/hooks/hook-registry', () => ({
  lifecycleHooks: { register: mock(() => undefined), unregister: mock(() => undefined) },
}));
mock.module('../../../core/config/scoped-config', () => ({
  scopedConfig: { set: mock(() => undefined), delete: mock(() => undefined) },
}));
mock.module('../domain-knowledge/domain-knowledge.service', () => ({
  domainKnowledgeService: {
    seed:   mock(async () => undefined),
    remove: mock(async () => undefined),
  },
}));
const mockDbSet  = mock(() => ({ where: mock(async () => []) }));
const mockDbSet2 = mock(async () => []);  // for simple set() calls
mock.module('../../../infra/db/client', () => ({
  db: {
    insert: mock(() => ({ values: mock(() => ({ onConflictDoUpdate: mock(async () => undefined) })) })),
    update: mock(() => ({ set: mock(() => ({ where: mock(async () => []) })) })),
  },
}));
mock.module('../../../infra/db/schema', () => ({
  adaptationAgents: {},
}));
mock.module('../../../jobs/learning/adaptation-agent.job', () => ({
  enqueueAdaptationAgent:  mock(async () => undefined),
  removeAdaptationAgent:   mock(async () => undefined),
}));

// Path is relative to THIS test file; resolves to src/modules/agent-profiles/agent-profiles.service
// (same physical file that plugin-manifest.ts imports as '../agent-profiles/agent-profiles.service')
mock.module('../../agent-profiles/agent-profiles.service', () => ({
  agentProfilesService: {
    create: mockCreateProfile,
    remove: mockRemoveProfile,
  },
}));

mock.module('../../../engine/gates/tool-approvals', () => ({
  toolApprovalsRegistry: {
    register:   mockRegisterGate,
    unregister: mockUnregisterGate,
  },
}));

mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => undefined), warn: mock(() => undefined), error: mock(() => undefined) },
}));

const { PluginManager } = await import('../plugin-manifest');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginManager.install() — domainPack', () => {
  let manager: InstanceType<typeof PluginManager>;

  beforeEach(() => {
    manager = new PluginManager();
    mockCreateProfile.mockClear();
    mockRemoveProfile.mockClear();
    mockRegisterGate.mockClear();
    mockUnregisterGate.mockClear();
  });

  const manifest: PluginManifest = {
    id: 'test-domain-plugin',
    name: 'Test Domain Plugin',
    version: '1.0.0',
    description: 'Test',
    domainPack: {
      defaultPermissionMode: 'ask',
      agentProfiles: [
        { name: 'Domain Executor', category: 'executor', permissionMode: 'ask' },
      ],
      approvalGates: [
        { toolPattern: 'domain:write', riskLevel: 'high' },
        { toolPattern: 'domain:read',  riskLevel: 'low' },
      ],
    },
  };

  it('seeds agent profiles with the workspace id injected', async () => {
    await manager.install(manifest, 'ws-abc');
    expect(mockCreateProfile).toHaveBeenCalledTimes(1);
    const [wid, input] = mockCreateProfile.mock.calls[0] as [string, Record<string, unknown>];
    expect(wid).toBe('ws-abc');
    expect(input.workspaceId).toBe('ws-abc');
    expect(input.name).toBe('Domain Executor');
  });

  it('registers approval gates for the workspace', async () => {
    await manager.install(manifest, 'ws-abc');
    expect(mockRegisterGate).toHaveBeenCalledTimes(2);
    expect(mockRegisterGate).toHaveBeenCalledWith('ws-abc', 'domain:write', 'high');
    expect(mockRegisterGate).toHaveBeenCalledWith('ws-abc', 'domain:read', 'low');
  });

  it('unregisters gates and removes profiles on uninstall', async () => {
    await manager.install(manifest, 'ws-abc');
    await manager.uninstall('test-domain-plugin', 'ws-abc');

    expect(mockUnregisterGate).toHaveBeenCalledTimes(2);
    expect(mockRemoveProfile).toHaveBeenCalledWith('profile-1');
  });

  it('does nothing when domainPack is absent', async () => {
    const simpleManifest: PluginManifest = {
      id: 'no-domain-pack', name: 'No Pack', version: '1.0.0', description: 'Test',
    };
    await manager.install(simpleManifest, 'ws-abc');
    expect(mockCreateProfile).not.toHaveBeenCalled();
    expect(mockRegisterGate).not.toHaveBeenCalled();
  });

  it('does not fail install when profile creation fails (non-fatal)', async () => {
    mockCreateProfile.mockImplementationOnce(async () => ({ ok: false, error: new Error('DB error') }) as any);
    await expect(manager.install(manifest, 'ws-fail')).resolves.toBeTypeOf('function');
  });
});
