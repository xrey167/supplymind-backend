import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { McpServerConfig } from '../types';

// --- Mocks for McpClient ---
const mockConnect = mock(async () => {});
const mockListTools = mock(async () => []);
const mockCallTool = mock(async () => 'result');
const mockDisconnect = mock(async () => {});
const mockIsConnected = mock(() => false);
const mockListResources = mock(async () => [{ uri: 'file:///x', name: 'x' }]);
const mockReadResource = mock(async (_uri: string) => 'resource text');
const mockListPrompts = mock(async () => [{ name: 'p1' }]);
const mockGetPrompt = mock(async (_name: string, _args?: any) => 'prompt result');

let mockLastUsedAt = Date.now();

mock.module('../client', () => ({
  McpClient: class {
    get lastUsedAt() { return mockLastUsedAt; }
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
    disconnect = mockDisconnect;
    isConnected = mockIsConnected;
    listResources = mockListResources;
    readResource = mockReadResource;
    listPrompts = mockListPrompts;
    getPrompt = mockGetPrompt;
  },
}));

const { McpClientPool } = await import('../client-pool');

const cfg = (): McpServerConfig => ({
  id: 'srv-1', workspaceId: 'ws-1', name: 'test',
  transport: 'stdio' as const, command: 'echo', enabled: true,
});

describe('McpClientPool', () => {
  let pool: InstanceType<typeof McpClientPool>;

  beforeEach(() => {
    pool = new McpClientPool();
    mockConnect.mockReset();
    mockConnect.mockImplementation(async () => {});
    mockListTools.mockReset();
    mockListTools.mockImplementation(async () => []);
    mockCallTool.mockReset();
    mockCallTool.mockImplementation(async () => 'result');
    mockDisconnect.mockReset();
    mockDisconnect.mockImplementation(async () => {});
    mockIsConnected.mockReset();
    mockIsConnected.mockImplementation(() => false);
    mockListResources.mockReset();
    mockListResources.mockImplementation(async () => [{ uri: 'file:///x', name: 'x' }]);
    mockReadResource.mockReset();
    mockReadResource.mockImplementation(async (_uri: string) => 'resource text');
    mockListPrompts.mockReset();
    mockListPrompts.mockImplementation(async () => [{ name: 'p1' }]);
    mockGetPrompt.mockReset();
    mockGetPrompt.mockImplementation(async (_name: string, _args?: any) => 'prompt result');
    mockLastUsedAt = Date.now();
  });

  describe('retry on connect failure', () => {
    it('retries up to 3 times and succeeds on 3rd attempt', async () => {
      let attempts = 0;
      mockConnect.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) throw new Error('refused');
      });
      mockListTools.mockResolvedValue([]);
      mockIsConnected.mockReturnValue(false);

      await pool.listTools(cfg());
      expect(attempts).toBe(3);
    });

    it('throws after 3 failed attempts', async () => {
      mockConnect.mockImplementation(async () => { throw new Error('refused'); });
      mockIsConnected.mockReturnValue(false);

      await expect(pool.listTools(cfg())).rejects.toThrow('refused');
      expect(mockConnect.mock.calls.length).toBe(3);
    });

    it('does not retry when already connected', async () => {
      mockIsConnected.mockReturnValue(true);
      mockListTools.mockResolvedValue([]);

      await pool.listTools(cfg());
      await pool.listTools(cfg());

      // First call connects once; second call hits the cached client (isConnected=true), no extra connects
      expect(mockConnect.mock.calls.length).toBe(1);
    });
  });

  describe('cleanupIdle', () => {
    it('disconnects clients idle longer than threshold', async () => {
      mockIsConnected.mockReturnValue(false);
      mockListTools.mockResolvedValue([]);
      await pool.listTools(cfg()); // establishes client

      mockLastUsedAt = Date.now() - 6 * 60 * 1000; // 6 min ago
      pool.cleanupIdle(5 * 60 * 1000);

      expect(mockDisconnect.mock.calls.length).toBe(1);
      // Assert the client is removed from the pool map
      await expect(pool.readResource('srv-1', 'file:///x')).rejects.toThrow('No MCP client');
    });

    it('keeps clients that are not idle', async () => {
      mockIsConnected.mockReturnValue(false);
      mockListTools.mockResolvedValue([]);
      await pool.listTools(cfg());

      mockLastUsedAt = Date.now() - 1 * 60 * 1000; // 1 min ago (not idle)
      pool.cleanupIdle(5 * 60 * 1000);

      expect(mockDisconnect.mock.calls.length).toBe(0);
    });
  });

  describe('passthrough methods', () => {
    it('listResources delegates to client', async () => {
      mockIsConnected.mockReturnValue(false);
      const resources = await pool.listResources(cfg());
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('file:///x');
    });

    it('readResource delegates to client after establishing connection', async () => {
      mockIsConnected.mockReturnValue(false);
      mockListTools.mockResolvedValue([]); // needed for getOrConnect
      await pool.listTools(cfg()); // establish client

      const text = await pool.readResource('srv-1', 'file:///x');
      expect(text).toBe('resource text');
    });

    it('listPrompts delegates to client', async () => {
      mockIsConnected.mockReturnValue(false);
      const prompts = await pool.listPrompts(cfg());
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('p1');
    });

    it('getPrompt delegates to client after establishing connection', async () => {
      mockIsConnected.mockReturnValue(false);
      mockListTools.mockResolvedValue([]);
      await pool.listTools(cfg()); // establish client

      const text = await pool.getPrompt('srv-1', 'summarize', { text: 'foo' });
      expect(text).toBe('prompt result');
    });

    it('readResource throws when no client exists for configId', async () => {
      await expect(pool.readResource('nonexistent', 'file:///x')).rejects.toThrow('No MCP client');
    });

    it('getPrompt throws when no client exists for configId', async () => {
      await expect(pool.getPrompt('nonexistent', 'summarize')).rejects.toThrow('No MCP client');
    });
  });
});
