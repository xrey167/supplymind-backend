import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { SkillMcpServerEntry } from '../types';

const mockConnect = mock(async () => {});
const mockListTools = mock(async () => [
  { name: 'search', description: 'Search', inputSchema: {}, serverName: 'analytics' },
]);
const mockCallTool = mock(async (_name: string, _args: any) => 'result');
const mockListResources = mock(async () => [{ uri: 'file:///x', name: 'x' }]);
const mockReadResource = mock(async (_uri: string) => 'resource text');
const mockListPrompts = mock(async () => [{ name: 'p1' }]);
const mockGetPrompt = mock(async (_name: string, _args?: any) => 'prompt result');
const mockDisconnect = mock(async () => {});
const mockIsConnected = mock(() => false);

mock.module('../client', () => ({
  McpClient: class {
    lastUsedAt = Date.now();
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
    listResources = mockListResources;
    readResource = mockReadResource;
    listPrompts = mockListPrompts;
    getPrompt = mockGetPrompt;
    disconnect = mockDisconnect;
    isConnected = mockIsConnected;
  },
}));

const { SkillEmbeddedMcpManager } = await import('../embedded-manager');

const httpEntry: SkillMcpServerEntry = { type: 'streamable-http', url: 'http://localhost:4000' };
const stdioEntry: SkillMcpServerEntry = { type: 'stdio', command: 'node', args: ['server.js'] };

describe('SkillEmbeddedMcpManager', () => {
  let manager: InstanceType<typeof SkillEmbeddedMcpManager>;

  beforeEach(() => {
    manager = new SkillEmbeddedMcpManager();
    mockConnect.mockClear();
    mockCallTool.mockClear();
    mockListTools.mockClear();
    mockListResources.mockClear();
    mockReadResource.mockClear();
    mockListPrompts.mockClear();
    mockGetPrompt.mockClear();
    mockDisconnect.mockClear();
    mockIsConnected.mockReturnValue(false);
  });

  describe('callTool', () => {
    it('connects lazily on first call', async () => {
      await manager.callTool('ws-1', 'skill-abc', 'analytics', httpEntry, 'search', { q: 'foo' });
      expect(mockConnect.mock.calls.length).toBe(1);
    });

    it('reuses client on second call (same key)', async () => {
      mockIsConnected.mockReturnValue(true);
      await manager.callTool('ws-1', 'skill-abc', 'analytics', httpEntry, 'search', { q: 'a' });
      await manager.callTool('ws-1', 'skill-abc', 'analytics', httpEntry, 'search', { q: 'b' });
      expect(mockConnect.mock.calls.length).toBe(1); // only first call connects
      expect(mockCallTool.mock.calls.length).toBe(2);
    });

    it('different skills get separate clients', async () => {
      await manager.callTool('ws-1', 'skill-A', 'analytics', httpEntry, 'search', {});
      await manager.callTool('ws-1', 'skill-B', 'analytics', httpEntry, 'search', {});
      expect(mockConnect.mock.calls.length).toBe(2);
    });

    it('different workspaces get separate clients', async () => {
      await manager.callTool('ws-1', 'skill-abc', 'analytics', httpEntry, 'search', {});
      await manager.callTool('ws-2', 'skill-abc', 'analytics', httpEntry, 'search', {});
      expect(mockConnect.mock.calls.length).toBe(2);
    });

    it('different mcp names on the same skill get separate clients', async () => {
      await manager.callTool('ws-1', 'skill-abc', 'analytics', httpEntry, 'search', {});
      await manager.callTool('ws-1', 'skill-abc', 'billing', stdioEntry, 'invoice', {});
      expect(mockConnect.mock.calls.length).toBe(2);
    });
  });

  describe('listTools', () => {
    it('returns tools from the MCP', async () => {
      const tools = await manager.listTools('ws-1', 'skill-abc', 'analytics', httpEntry);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('search');
    });
  });

  describe('listResources', () => {
    it('returns resources from the MCP', async () => {
      const resources = await manager.listResources('ws-1', 'skill-abc', 'analytics', httpEntry);
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('file:///x');
    });
  });

  describe('readResource', () => {
    it('returns resource text', async () => {
      const text = await manager.readResource('ws-1', 'skill-abc', 'analytics', httpEntry, 'file:///x');
      expect(text).toBe('resource text');
      expect(mockReadResource.mock.calls[0][0]).toBe('file:///x');
    });
  });

  describe('listPrompts', () => {
    it('returns prompts from the MCP', async () => {
      const prompts = await manager.listPrompts('ws-1', 'skill-abc', 'analytics', httpEntry);
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('p1');
    });
  });

  describe('getPrompt', () => {
    it('returns prompt text', async () => {
      const text = await manager.getPrompt('ws-1', 'skill-abc', 'analytics', httpEntry, 'summarize');
      expect(text).toBe('prompt result');
      expect(mockGetPrompt.mock.calls[0][0]).toBe('summarize');
    });
  });

  describe('cleanupIdle', () => {
    it('disconnects clients idle past threshold', async () => {
      await manager.callTool('ws-1', 'skill-abc', 'analytics', httpEntry, 'search', {});
      // reach into the manager's client and set its lastUsedAt to a long time ago
      // We do this by accessing the internal map via the manager's activeCount
      expect(manager.activeCount()).toBe(1);

      // Simulate time passing: set mockLastUsedAt for the McpClient instance
      // Since we can't directly manipulate, set the threshold very low
      pool_wait: {
        // Wait a tick and cleanup with threshold 0ms (everything is idle)
        manager.cleanupIdle(0);
      }
      expect(manager.activeCount()).toBe(0);
      expect(mockDisconnect.mock.calls.length).toBe(1);
    });
  });

  describe('disconnectAll', () => {
    it('disconnects all clients and clears the map', async () => {
      await manager.callTool('ws-1', 'skill-A', 'analytics', httpEntry, 'search', {});
      await manager.callTool('ws-1', 'skill-B', 'analytics', httpEntry, 'search', {});
      expect(manager.activeCount()).toBe(2);

      await manager.disconnectAll();
      expect(mockDisconnect.mock.calls.length).toBe(2);
      expect(manager.activeCount()).toBe(0);
    });
  });

  describe('activeCount', () => {
    it('returns 0 initially', () => {
      expect(manager.activeCount()).toBe(0);
    });

    it('increments on each new connection', async () => {
      await manager.callTool('ws-1', 'skill-A', 'analytics', httpEntry, 'search', {});
      expect(manager.activeCount()).toBe(1);
      await manager.callTool('ws-1', 'skill-B', 'analytics', httpEntry, 'search', {});
      expect(manager.activeCount()).toBe(2);
    });
  });
});
