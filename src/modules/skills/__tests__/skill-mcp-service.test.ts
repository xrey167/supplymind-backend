import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';
import { skillsRepo } from '../skills.repo';
import { SkillsService } from '../skills.service';

// ---------- Mocks ----------

const mockFindById = spyOn(skillsRepo, 'findById').mockResolvedValue(undefined as any);
const mockGetMcpConfig = spyOn(skillsRepo, 'getMcpConfig').mockResolvedValue(null as any);
const mockSetMcpConfig = spyOn(skillsRepo, 'setMcpConfig').mockResolvedValue(undefined as any);

afterAll(() => {
  mockFindById.mockRestore();
  mockGetMcpConfig.mockRestore();
  mockSetMcpConfig.mockRestore();
});

const VALID_CONFIG = {
  analytics: { type: 'streamable-http' as const, url: 'http://localhost:4000' },
};

describe('SkillsService — MCP config', () => {
  let service: SkillsService;

  beforeEach(() => {
    service = new SkillsService();
    mockFindById.mockClear();
    mockGetMcpConfig.mockClear();
    mockSetMcpConfig.mockClear();
  });

  describe('getMcpConfig', () => {
    it('returns null when skill has no mcp_config stored', async () => {
      mockFindById.mockResolvedValueOnce({ id: 'skill-1', workspaceId: 'ws-1' } as any);
      mockGetMcpConfig.mockResolvedValueOnce(null);

      const result = await service.getMcpConfig('ws-1', 'skill-1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it('returns err when stored config is invalid (safeParse fails)', async () => {
      mockFindById.mockResolvedValueOnce({ id: 'skill-1', workspaceId: 'ws-1' } as any);
      mockGetMcpConfig.mockResolvedValueOnce({ bad: { type: 'grpc' } } as any);

      const result = await service.getMcpConfig('ws-1', 'skill-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('invalid');
    });

    it('returns err when skill not found', async () => {
      mockFindById.mockResolvedValueOnce(undefined as any);

      const result = await service.getMcpConfig('ws-1', 'skill-missing');
      expect(result.ok).toBe(false);
    });

    it('returns err when skill belongs to different workspace', async () => {
      mockFindById.mockResolvedValueOnce({ id: 'skill-1', workspaceId: 'ws-other' } as any);

      const result = await service.getMcpConfig('ws-1', 'skill-1');
      expect(result.ok).toBe(false);
    });

    it('allows any workspace to read a global skill (null workspaceId)', async () => {
      mockFindById.mockResolvedValueOnce({ id: 'skill-global', workspaceId: null } as any);
      mockGetMcpConfig.mockResolvedValueOnce(VALID_CONFIG as any);

      const result = await service.getMcpConfig('ws-anything', 'skill-global');
      expect(result.ok).toBe(true);
    });
  });

  describe('setMcpConfig', () => {
    it('saves config for a workspace-owned skill', async () => {
      mockFindById.mockResolvedValueOnce({ id: 'skill-1', workspaceId: 'ws-1' } as any);

      const result = await service.setMcpConfig('ws-1', 'skill-1', VALID_CONFIG);
      expect(result.ok).toBe(true);
      expect(mockSetMcpConfig.mock.calls.length).toBe(1);
    });

    it('returns err for global skill (null workspaceId) — cannot mutate shared state', async () => {
      mockFindById.mockResolvedValueOnce({ id: 'skill-global', workspaceId: null } as any);

      const result = await service.setMcpConfig('ws-1', 'skill-global', VALID_CONFIG);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('global skill');
      expect(mockSetMcpConfig.mock.calls.length).toBe(0);
    });

    it('returns err when skill belongs to different workspace', async () => {
      mockFindById.mockResolvedValueOnce({ id: 'skill-1', workspaceId: 'ws-other' } as any);

      const result = await service.setMcpConfig('ws-1', 'skill-1', VALID_CONFIG);
      expect(result.ok).toBe(false);
      expect(mockSetMcpConfig.mock.calls.length).toBe(0);
    });

    it('returns err when skill not found', async () => {
      mockFindById.mockResolvedValueOnce(undefined as any);

      const result = await service.setMcpConfig('ws-1', 'skill-missing', VALID_CONFIG);
      expect(result.ok).toBe(false);
    });
  });
});
