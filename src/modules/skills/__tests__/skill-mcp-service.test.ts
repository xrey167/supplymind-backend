import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------- Mocks ----------

const mockFindById = mock(async (_id: string) => undefined as any);
const mockGetMcpConfig = mock(async (_id: string) => null as any);
const mockSetMcpConfig = mock(async (_id: string, _cfg: unknown) => {});

mock.module('../skills.repo', () => ({
  skillsRepo: {
    findById: mockFindById,
    getMcpConfig: mockGetMcpConfig,
    setMcpConfig: mockSetMcpConfig,
    findGlobal: mock(async () => []),
  },
}));

// Stub out providers so loadSkills() is a no-op
mock.module('../providers/builtin.provider', () => ({
  BuiltinSkillProvider: class { async loadSkills() { return []; } },
}));
mock.module('../providers/collaboration.provider', () => ({
  CollaborationSkillProvider: class { async loadSkills() { return []; } },
}));
mock.module('../providers/workflow.provider', () => ({
  WorkflowSkillProvider: class { async loadSkills() { return []; } },
}));
mock.module('../skills.registry', () => ({
  skillRegistry: {
    loadFromProviders: mock(async () => {}),
    register: mock(() => {}),
    list: mock(() => []),
  },
}));
mock.module('../../tools/tools.service', () => ({ toolsService: { toSkill: mock(() => ({})) } }));
mock.module('../skills.dispatch', () => ({ dispatchSkill: mock(async () => ({ ok: true, value: null })) }));

const { SkillsService } = await import('../skills.service');

const VALID_CONFIG = {
  analytics: { type: 'streamable-http' as const, url: 'http://localhost:4000' },
};

describe('SkillsService — MCP config', () => {
  let service: InstanceType<typeof SkillsService>;

  beforeEach(() => {
    service = new SkillsService();
    mockFindById.mockClear();
    mockGetMcpConfig.mockClear();
    mockSetMcpConfig.mockClear();
  });

  describe('getMcpConfig', () => {
    it('returns null when skill has no mcp_config stored', async () => {
      mockFindById.mockImplementationOnce(async () => ({ id: 'skill-1', workspaceId: 'ws-1' }));
      mockGetMcpConfig.mockImplementationOnce(async () => null);

      const result = await service.getMcpConfig('ws-1', 'skill-1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it('returns err when stored config is invalid (safeParse fails)', async () => {
      mockFindById.mockImplementationOnce(async () => ({ id: 'skill-1', workspaceId: 'ws-1' }));
      mockGetMcpConfig.mockImplementationOnce(async () => ({ bad: { type: 'grpc' } }));

      const result = await service.getMcpConfig('ws-1', 'skill-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('invalid');
    });

    it('returns err when skill not found', async () => {
      mockFindById.mockImplementationOnce(async () => undefined);

      const result = await service.getMcpConfig('ws-1', 'skill-missing');
      expect(result.ok).toBe(false);
    });

    it('returns err when skill belongs to different workspace', async () => {
      mockFindById.mockImplementationOnce(async () => ({ id: 'skill-1', workspaceId: 'ws-other' }));

      const result = await service.getMcpConfig('ws-1', 'skill-1');
      expect(result.ok).toBe(false);
    });

    it('allows any workspace to read a global skill (null workspaceId)', async () => {
      mockFindById.mockImplementationOnce(async () => ({ id: 'skill-global', workspaceId: null }));
      mockGetMcpConfig.mockImplementationOnce(async () => VALID_CONFIG);

      const result = await service.getMcpConfig('ws-anything', 'skill-global');
      expect(result.ok).toBe(true);
    });
  });

  describe('setMcpConfig', () => {
    it('saves config for a workspace-owned skill', async () => {
      mockFindById.mockImplementationOnce(async () => ({ id: 'skill-1', workspaceId: 'ws-1' }));

      const result = await service.setMcpConfig('ws-1', 'skill-1', VALID_CONFIG);
      expect(result.ok).toBe(true);
      expect(mockSetMcpConfig.mock.calls.length).toBe(1);
    });

    it('returns err for global skill (null workspaceId) — cannot mutate shared state', async () => {
      mockFindById.mockImplementationOnce(async () => ({ id: 'skill-global', workspaceId: null }));

      const result = await service.setMcpConfig('ws-1', 'skill-global', VALID_CONFIG);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('global skill');
      expect(mockSetMcpConfig.mock.calls.length).toBe(0);
    });

    it('returns err when skill belongs to different workspace', async () => {
      mockFindById.mockImplementationOnce(async () => ({ id: 'skill-1', workspaceId: 'ws-other' }));

      const result = await service.setMcpConfig('ws-1', 'skill-1', VALID_CONFIG);
      expect(result.ok).toBe(false);
      expect(mockSetMcpConfig.mock.calls.length).toBe(0);
    });

    it('returns err when skill not found', async () => {
      mockFindById.mockImplementationOnce(async () => undefined);

      const result = await service.setMcpConfig('ws-1', 'skill-missing', VALID_CONFIG);
      expect(result.ok).toBe(false);
    });
  });
});
