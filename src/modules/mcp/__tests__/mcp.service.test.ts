import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { McpServerRow } from '../mcp.repo';

// ---------- Helpers ----------

function makeRow(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: 'cfg-1',
    workspaceId: 'ws-1',
    name: 'test-server',
    transport: 'stdio',
    url: null,
    command: 'node',
    args: [],
    env: null,
    headers: null,
    enabled: true,
    toolManifestCache: null,
    cacheExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------- Mocks ----------

const mockFindGlobal = mock(async (): Promise<McpServerRow[]> => []);
const mockFindByWorkspace = mock(async (_wid: string): Promise<McpServerRow[]> => []);
const mockFindById = mock(async (_id: string): Promise<McpServerRow | undefined> => undefined);
const mockCreate = mock(async (data: unknown): Promise<McpServerRow> => makeRow(data as Partial<McpServerRow>));
const mockUpdate = mock(async (_id: string, _data: unknown): Promise<McpServerRow | undefined> => makeRow());
const mockRemoveRepo = mock(async (_id: string): Promise<void> => {});

mock.module('../mcp.repo', () => ({
  mcpRepo: {
    findGlobal: mockFindGlobal,
    findByWorkspace: mockFindByWorkspace,
    findById: mockFindById,
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemoveRepo,
  },
  McpRepo: class {},
}));

const mockRegister = mock((_skill: unknown) => {});

mock.module('../../skills/skills.registry', () => ({
  skillRegistry: {
    register: mockRegister,
  },
}));

const mockListTools = mock(async (_config: unknown) => ({
  serverName: 'test-server',
  tools: [
    { name: 'tool_a', description: 'Tool A', inputSchema: {}, serverName: 'test-server' },
    { name: 'tool_b', description: 'Tool B', inputSchema: {}, serverName: 'test-server' },
  ],
  fetchedAt: Date.now(),
}));

const mockCallTool = mock(async (_configId: string, _toolName: string, _args: unknown) => 'result');

mock.module('../../../infra/mcp/client-pool', () => ({
  mcpClientPool: {
    listTools: mockListTools,
    callTool: mockCallTool,
  },
}));

const mockPublish = mock((_topic: string, _payload: unknown) => {});

mock.module('../../../events/bus', () => ({
  eventBus: { publish: mockPublish },
}));

mock.module('../../../events/topics', () => ({
  Topics: { MCP_TOOLS_DISCOVERED: 'mcp.tools.discovered' },
}));

// ---------- Import after mocks ----------
const { McpService } = await import('../mcp.service');

// ---------- Tests ----------
describe('McpService', () => {
  let service: InstanceType<typeof McpService>;

  beforeEach(() => {
    service = new McpService();
    mockFindGlobal.mockClear();
    mockFindByWorkspace.mockClear();
    mockFindById.mockClear();
    mockCreate.mockClear();
    mockUpdate.mockClear();
    mockRemoveRepo.mockClear();
    mockRegister.mockClear();
    mockListTools.mockClear();
    mockCallTool.mockClear();
    mockPublish.mockClear();
  });

  describe('loadGlobalServers()', () => {
    it('calls findGlobal and registers skills for each enabled server', async () => {
      mockFindGlobal.mockImplementationOnce(async () => [makeRow()]);

      await service.loadGlobalServers();

      expect(mockFindGlobal).toHaveBeenCalledTimes(1);
      expect(mockListTools).toHaveBeenCalledTimes(1);
      // 2 tools = 2 skill registrations
      expect(mockRegister).toHaveBeenCalledTimes(2);
      expect(mockPublish).toHaveBeenCalledWith('mcp.tools.discovered', {
        serverId: 'cfg-1',
        serverName: 'test-server',
        toolCount: 2,
      });
    });

    it('skips disabled servers', async () => {
      mockFindGlobal.mockImplementationOnce(async () => [makeRow({ enabled: false })]);

      await service.loadGlobalServers();

      expect(mockListTools).not.toHaveBeenCalled();
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('warns and continues when a server fails to load', async () => {
      mockFindGlobal.mockImplementationOnce(async () => [makeRow()]);
      mockListTools.mockImplementationOnce(async () => { throw new Error('Connection refused'); });

      await expect(service.loadGlobalServers()).resolves.toBeUndefined();
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  describe('ensureWorkspaceLoaded()', () => {
    it('loads workspace MCP servers on first call', async () => {
      mockFindByWorkspace.mockImplementationOnce(async () => [makeRow()]);

      await service.ensureWorkspaceLoaded('ws-1');

      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1');
      expect(mockListTools).toHaveBeenCalledTimes(1);
      expect(mockRegister).toHaveBeenCalledTimes(2);
    });

    it('is idempotent — second call for same workspace is a no-op', async () => {
      mockFindByWorkspace.mockImplementationOnce(async () => [makeRow()]);

      await service.ensureWorkspaceLoaded('ws-1');
      await service.ensureWorkspaceLoaded('ws-1');

      // findByWorkspace called exactly once despite two calls
      expect(mockFindByWorkspace).toHaveBeenCalledTimes(1);
      expect(mockListTools).toHaveBeenCalledTimes(1);
    });

    it('loads different workspaces independently', async () => {
      mockFindByWorkspace.mockImplementation(async () => [makeRow()]);

      await service.ensureWorkspaceLoaded('ws-1');
      await service.ensureWorkspaceLoaded('ws-2');

      expect(mockFindByWorkspace).toHaveBeenCalledTimes(2);
    });
  });

  describe('testConnection()', () => {
    it('returns tool names for a valid config', async () => {
      mockFindById.mockImplementationOnce(async () => makeRow());

      const result = await service.testConnection('ws-1', 'cfg-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tools).toEqual(['tool_a', 'tool_b']);
      }
    });

    it('returns err when config not found', async () => {
      mockFindById.mockImplementationOnce(async () => undefined);

      const result = await service.testConnection('ws-1', 'missing-id');

      expect(result.ok).toBe(false);
    });

    it('returns err when config belongs to different workspace', async () => {
      mockFindById.mockImplementationOnce(async () => makeRow({ workspaceId: 'ws-other' }));

      const result = await service.testConnection('ws-1', 'cfg-1');

      expect(result.ok).toBe(false);
    });

    it('returns err when mcpClientPool.listTools throws', async () => {
      mockFindById.mockImplementationOnce(async () => makeRow());
      mockListTools.mockImplementationOnce(async () => { throw new Error('Timeout'); });

      const result = await service.testConnection('ws-1', 'cfg-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Timeout');
      }
    });
  });

  describe('list()', () => {
    it('returns configs for the given workspace', async () => {
      mockFindByWorkspace.mockImplementationOnce(async () => [makeRow(), makeRow({ id: 'cfg-2' })]);

      const result = await service.list('ws-1');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(2);
    });
  });

  describe('remove()', () => {
    it('removes an existing config', async () => {
      mockFindById.mockImplementationOnce(async () => makeRow());

      const result = await service.remove('ws-1', 'cfg-1');

      expect(result.ok).toBe(true);
      expect(mockRemoveRepo).toHaveBeenCalledWith('cfg-1');
    });

    it('returns err when config not found', async () => {
      mockFindById.mockImplementationOnce(async () => undefined);

      const result = await service.remove('ws-1', 'cfg-1');

      expect(result.ok).toBe(false);
    });

    it('returns err when config belongs to different workspace', async () => {
      mockFindById.mockImplementationOnce(async () => makeRow({ workspaceId: 'ws-other' }));

      const result = await service.remove('ws-1', 'cfg-1');

      expect(result.ok).toBe(false);
      expect(mockRemoveRepo).not.toHaveBeenCalled();
    });
  });
});
