import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';

const mockGet = mock(async () => null as any);
const mockGetAll = mock(async () => [] as any[]);
const mockSet = mock(async () => ({} as any));
const mockDelete = mock(async () => true);

mock.module('../workspace-settings.repo', () => ({
  workspaceSettingsRepo: {
    get: mockGet,
    getAll: mockGetAll,
    set: mockSet,
    delete: mockDelete,
  },
}));

import { WorkspaceSettingsService } from '../workspace-settings.service';
import { WorkspaceSettingKeys } from '../workspace-settings.schemas';

describe('WorkspaceSettingsService', () => {
  let service: WorkspaceSettingsService;

  beforeEach(() => {
    service = new WorkspaceSettingsService();
    mockGet.mockClear();
    mockGetAll.mockClear();
    mockSet.mockClear();
    mockDelete.mockClear();
  });

  describe('getRaw', () => {
    test('should return value when setting exists', async () => {
      mockGet.mockResolvedValueOnce({ key: 'tool_permission_mode', value: 'strict' });

      const result = await service.getRaw('ws-1', WorkspaceSettingKeys.TOOL_PERMISSION_MODE);

      expect(result).toBe('strict');
      expect(mockGet).toHaveBeenCalledWith('ws-1', 'tool_permission_mode');
    });

    test('should return null when setting does not exist', async () => {
      mockGet.mockResolvedValueOnce(null);

      const result = await service.getRaw('ws-1', WorkspaceSettingKeys.TOOL_PERMISSION_MODE);

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    test('should delegate to repo', async () => {
      await service.set('ws-1', WorkspaceSettingKeys.TOOL_PERMISSION_MODE, 'strict');

      expect(mockSet).toHaveBeenCalledWith('ws-1', 'tool_permission_mode', 'strict');
    });
  });

  describe('delete', () => {
    test('should delegate to repo', async () => {
      mockDelete.mockResolvedValueOnce(true);

      const result = await service.delete('ws-1', WorkspaceSettingKeys.TOOL_PERMISSION_MODE);

      expect(result).toBe(true);
    });
  });

  describe('getAll', () => {
    test('should return key-value map', async () => {
      mockGetAll.mockResolvedValueOnce([
        { key: 'tool_permission_mode', value: 'ask' },
        { key: 'sandbox_policy', value: { maxTimeoutMs: 5000 } },
      ]);

      const result = await service.getAll('ws-1');

      expect(result).toEqual({
        tool_permission_mode: 'ask',
        sandbox_policy: { maxTimeoutMs: 5000 },
      });
    });

    test('should return empty object when no settings exist', async () => {
      mockGetAll.mockResolvedValueOnce([]);

      const result = await service.getAll('ws-1');

      expect(result).toEqual({});
    });
  });

  describe('getToolPermissionMode', () => {
    test('should return stored mode when set', async () => {
      mockGet.mockResolvedValueOnce({ key: 'tool_permission_mode', value: 'strict' });

      const mode = await service.getToolPermissionMode('ws-1');

      expect(mode).toBe('strict');
    });

    test('should default to auto when not set', async () => {
      mockGet.mockResolvedValueOnce(null);

      const mode = await service.getToolPermissionMode('ws-1');

      expect(mode).toBe('auto');
    });

    test('should fall back to auto for invalid values', async () => {
      mockGet.mockResolvedValueOnce({ key: 'tool_permission_mode', value: 'invalid' });

      const result = await service.getToolPermissionMode('ws-1');
      expect(result).toBe('auto');
    });
  });

  describe('getSandboxPolicy', () => {
    test('should return stored policy with defaults filled in', async () => {
      mockGet.mockResolvedValueOnce({ key: 'sandbox_policy', value: { maxTimeoutMs: 5000 } });

      const policy = await service.getSandboxPolicy('ws-1');

      expect(policy.maxTimeoutMs).toBe(5000);
      expect(policy.allowNetwork).toBe(false);
      expect(policy.maxMemoryMb).toBe(128);
      expect(policy.allowedPaths).toEqual([]);
    });

    test('should return all defaults when not set', async () => {
      mockGet.mockResolvedValueOnce(null);

      const policy = await service.getSandboxPolicy('ws-1');

      expect(policy.maxTimeoutMs).toBe(30_000);
      expect(policy.allowNetwork).toBe(false);
      expect(policy.lockedByOrg).toBe(false);
    });
  });

  describe('getMcpServerPolicy', () => {
    test('should return stored policy', async () => {
      mockGet.mockResolvedValueOnce({
        key: 'mcp_server_policy',
        value: { allowedServerIds: ['server-1'], requireApproval: true },
      });

      const policy = await service.getMcpServerPolicy('ws-1');

      expect(policy.allowedServerIds).toEqual(['server-1']);
      expect(policy.requireApproval).toBe(true);
    });

    test('should return defaults when not set', async () => {
      mockGet.mockResolvedValueOnce(null);

      const policy = await service.getMcpServerPolicy('ws-1');

      expect(policy.allowedServerIds).toEqual([]);
      expect(policy.requireApproval).toBe(false);
    });
  });
});

afterAll(() => mock.restore());
