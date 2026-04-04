import { describe, test, expect, mock, beforeEach } from 'bun:test';

// --- mock modules BEFORE importing the module under test ---

const mockFindById = mock(async (_id: string) => null as any);
const mockFindByWorkspace = mock(async (_workspaceId?: string) => [] as any[]);
const mockCreate = mock(async (_input: any) => ({} as any));
const mockUpdate = mock(async (_id: string, _input: any) => null as any);
const mockRemove = mock(async (_id: string) => undefined);

mock.module('../tools.repo', () => ({
  toolsRepo: {
    findById: mockFindById,
    findByWorkspace: mockFindByWorkspace,
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
  },
}));

const mockRegistryRegister = mock((_tool: any) => undefined);
const mockRegistryUnregister = mock((_name: string) => undefined);

mock.module('../tools.registry', () => ({
  toolRegistry: {
    register: mockRegistryRegister,
    unregister: mockRegistryUnregister,
  },
}));

const mockCallTool = mock(async (_server: string, _tool: string, _args: any) => 'mcp-result');

mock.module('../../../infra/mcp/client-pool', () => ({
  mcpClientPool: {
    callTool: mockCallTool,
  },
}));

const mockEnqueueSkill = mock(async (_payload: any, _opts: any) => ({ success: true, value: 'worker-result' }));

mock.module('../../../infra/queue/bullmq', () => ({
  enqueueSkill: mockEnqueueSkill,
}));

mock.module('../../../config/logger', () => ({
  logger: {
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    debug: mock(() => undefined),
  },
}));

// --- import after mocks ---
import { ToolsService } from '../tools.service';

// Helpers
const makeRow = (overrides?: Partial<any>) => ({
  id: 'tool-id-1',
  workspaceId: null,
  name: 'my_tool',
  description: 'A tool',
  providerType: 'builtin',
  priority: 5,
  inputSchema: { type: 'object' },
  handlerConfig: {},
  enabled: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

describe('ToolsService', () => {
  let service: ToolsService;

  beforeEach(() => {
    service = new ToolsService();
    mockFindById.mockClear();
    mockFindByWorkspace.mockClear();
    mockCreate.mockClear();
    mockUpdate.mockClear();
    mockRemove.mockClear();
    mockRegistryRegister.mockClear();
    mockRegistryUnregister.mockClear();
    mockCallTool.mockClear();
    mockEnqueueSkill.mockClear();
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    test('should return mapped ToolDefs for a workspace', async () => {
      const row = makeRow();
      mockFindByWorkspace.mockResolvedValueOnce([row] as any);

      const result = await service.list('ws-1');

      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tool-id-1');
      expect(result[0].name).toBe('my_tool');
    });

    test('should return empty array when no tools exist', async () => {
      mockFindByWorkspace.mockResolvedValueOnce([] as any);
      const result = await service.list();
      expect(result).toEqual([]);
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────

  describe('getById', () => {
    test('should return ok with ToolDef when tool exists', async () => {
      const row = makeRow();
      mockFindById.mockResolvedValueOnce(row as any);

      const result = await service.getById('tool-id-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('tool-id-1');
        expect(result.value.name).toBe('my_tool');
      }
    });

    test('should return err when tool is not found', async () => {
      mockFindById.mockResolvedValueOnce(null as any);

      const result = await service.getById('missing-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('missing-id');
      }
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    test('should persist tool and register in registry', async () => {
      const row = makeRow({ providerType: 'builtin' });
      mockCreate.mockResolvedValueOnce(row as any);

      const input = {
        name: 'my_tool',
        description: 'A tool',
        providerType: 'builtin',
      };
      const result = await service.create(input);

      expect(result.ok).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(input);
      expect(mockRegistryRegister).toHaveBeenCalledTimes(1);

      const registeredArg = mockRegistryRegister.mock.calls[0][0];
      expect(registeredArg.name).toBe('my_tool');
      expect(registeredArg.source).toBe('db');
      expect(typeof registeredArg.handler).toBe('function');
    });

    test('should register mcp tool with correct handler', async () => {
      const row = makeRow({
        providerType: 'mcp',
        handlerConfig: { serverName: 'my-server', toolName: 'remote_fn' },
      });
      mockCreate.mockResolvedValueOnce(row as any);

      const result = await service.create({
        name: 'my_tool',
        description: 'A tool',
        providerType: 'mcp',
        handlerConfig: { serverName: 'my-server', toolName: 'remote_fn' },
      });

      expect(result.ok).toBe(true);
      const registeredArg = mockRegistryRegister.mock.calls[0][0];

      // invoke the handler to confirm MCP delegation
      mockCallTool.mockResolvedValueOnce('mcp-data' as any);
      const handlerResult = await registeredArg.handler({ q: 1 });
      expect(handlerResult.ok).toBe(true);
      expect(mockCallTool).toHaveBeenCalledWith('my-server', 'remote_fn', { q: 1 });
    });

    test('should register worker tool with correct handler', async () => {
      const row = makeRow({
        name: 'worker_tool',
        providerType: 'worker',
        handlerConfig: { timeout: 5000 },
      });
      mockCreate.mockResolvedValueOnce(row as any);

      await service.create({
        name: 'worker_tool',
        description: 'A tool',
        providerType: 'worker',
        handlerConfig: { timeout: 5000 },
      });

      const registeredArg = mockRegistryRegister.mock.calls[0][0];
      mockEnqueueSkill.mockResolvedValueOnce({ success: true, value: 'done' } as any);
      const handlerResult = await registeredArg.handler({ x: 2 }, { workspaceId: 'ws-1', callerId: 'agent-1' });
      expect(handlerResult.ok).toBe(true);
      expect(mockEnqueueSkill).toHaveBeenCalledTimes(1);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    test('should return ok and re-register when tool exists', async () => {
      const row = makeRow({ description: 'Updated desc' });
      mockUpdate.mockResolvedValueOnce(row as any);

      const result = await service.update('tool-id-1', { description: 'Updated desc' });

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('tool-id-1', { description: 'Updated desc' });
      expect(mockRegistryRegister).toHaveBeenCalledTimes(1);

      const registeredArg = mockRegistryRegister.mock.calls[0][0];
      expect(registeredArg.source).toBe('db');
    });

    test('should return err when tool is not found', async () => {
      mockUpdate.mockResolvedValueOnce(null as any);

      const result = await service.update('missing-id', { description: 'x' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('missing-id');
      }
      expect(mockRegistryRegister).not.toHaveBeenCalled();
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    test('should unregister from registry and delete from DB', async () => {
      const row = makeRow();
      mockFindById.mockResolvedValueOnce(row as any);

      await service.remove('tool-id-1');

      expect(mockRegistryUnregister).toHaveBeenCalledWith('my_tool');
      expect(mockRemove).toHaveBeenCalledWith('tool-id-1');
    });

    test('should still remove from DB when tool not found in registry', async () => {
      mockFindById.mockResolvedValueOnce(null as any);

      await service.remove('ghost-id');

      expect(mockRegistryUnregister).not.toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalledWith('ghost-id');
    });
  });

  // ── loadToolsFromDb ───────────────────────────────────────────────────────

  describe('loadToolsFromDb', () => {
    test('should register enabled tools and skip disabled ones', async () => {
      const enabledRow = makeRow({ id: 'tool-a', name: 'enabled_tool', enabled: true });
      const disabledRow = makeRow({ id: 'tool-b', name: 'disabled_tool', enabled: false });
      mockFindByWorkspace.mockResolvedValueOnce([enabledRow, disabledRow] as any);

      const result = await service.loadToolsFromDb('ws-1');

      expect(result).toHaveLength(2);
      // Only the enabled tool should be registered
      expect(mockRegistryRegister).toHaveBeenCalledTimes(1);
      const registeredArg = mockRegistryRegister.mock.calls[0][0];
      expect(registeredArg.name).toBe('enabled_tool');
    });

    test('should return all tools regardless of enabled flag', async () => {
      const rows = [
        makeRow({ id: 'a', name: 'tool_a', enabled: true }),
        makeRow({ id: 'b', name: 'tool_b', enabled: false }),
        makeRow({ id: 'c', name: 'tool_c', enabled: true }),
      ];
      mockFindByWorkspace.mockResolvedValueOnce(rows as any);

      const result = await service.loadToolsFromDb();

      expect(result).toHaveLength(3);
      expect(mockRegistryRegister).toHaveBeenCalledTimes(2);
    });

    test('should return empty array when no tools in DB', async () => {
      mockFindByWorkspace.mockResolvedValueOnce([] as any);

      const result = await service.loadToolsFromDb();

      expect(result).toEqual([]);
      expect(mockRegistryRegister).not.toHaveBeenCalled();
    });
  });
});
