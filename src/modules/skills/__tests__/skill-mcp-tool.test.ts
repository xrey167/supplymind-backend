import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { ok, err } from '../../../core/result';
import type { DispatchContext } from '../skills.types';

// Mock skillsService
const mockGetMcpConfig = mock(async (_wid: string, _sid: string) =>
  ok({ analytics: { type: 'streamable-http' as const, url: 'http://localhost:4000' } })
);

mock.module('../skills.service', () => ({
  skillsService: {
    getMcpConfig: (wid: string, sid: string) => mockGetMcpConfig(wid, sid),
  },
  SkillsService: class {},
}));

// Full SkillEmbeddedMcpManager mock with all methods so embedded-manager.test.ts
// can still construct real instances via the exported class.
const mockManagerCallTool = mock(async () => 'tool result');
const mockManagerListTools = mock(async () => [
  { name: 'search', description: 'Search the index', inputSchema: {} },
]);
const mockManagerReadResource = mock(async () => 'resource content');
const mockManagerGetPrompt = mock(async () => 'prompt text');

mock.module('../../../infra/mcp/embedded-manager', () => {
  class SkillEmbeddedMcpManager {
    callTool = mockManagerCallTool;
    listTools = mockManagerListTools;
    readResource = mockManagerReadResource;
    getPrompt = mockManagerGetPrompt;
    listResources = mock(async () => []);
    listPrompts = mock(async () => []);
    cleanupIdle = () => {};
    disconnectAll = async () => {};
    activeCount = () => 0;
    constructor(_factory?: any) {}
  }
  return {
    skillEmbeddedMcpManager: new SkillEmbeddedMcpManager(),
    SkillEmbeddedMcpManager,
  }),
}));

const { BuiltinSkillProvider } = await import('../providers/builtin.provider');

const ctx: DispatchContext = {
  callerId: 'agent-1',
  workspaceId: 'ws-1',
  callerRole: 'operator',
};

describe('skill_mcp builtin skill', () => {
  let skillMcp: Awaited<ReturnType<InstanceType<typeof BuiltinSkillProvider>['loadSkills']>>[number];

  beforeEach(async () => {
    const provider = new BuiltinSkillProvider();
    const skills = await provider.loadSkills();
    skillMcp = skills.find((s) => s.name === 'skill_mcp')!;
    mockGetMcpConfig.mockClear();
    mockManagerCallTool.mockClear();
    mockManagerListTools.mockClear();
    mockManagerReadResource.mockClear();
    mockManagerGetPrompt.mockClear();
  });

  it('skill_mcp is registered with providerType builtin', () => {
    expect(skillMcp).toBeDefined();
    expect(skillMcp.providerType).toBe('builtin');
    expect(skillMcp.name).toBe('skill_mcp');
    expect(skillMcp.concurrencySafe).toBe(true);
  });

  it('call_tool operation returns tool result', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
      name: 'search',
      arguments: { q: 'inventory' },
    }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('tool result');
    expect(mockManagerCallTool.mock.calls.length).toBe(1);
  });

  it('list_tools operation returns tool list', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'list_tools',
    }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const tools = result.value as any[];
      expect(Array.isArray(tools)).toBe(true);
      expect(tools[0].name).toBe('search');
    }
    expect(mockManagerListTools.mock.calls.length).toBe(1);
  });

  it('read_resource operation returns resource content', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'read_resource',
      name: 'file:///data.json',
    }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('resource content');
    expect(mockManagerReadResource.mock.calls.length).toBe(1);
  });

  it('get_prompt operation returns prompt text', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'get_prompt',
      name: 'summarize',
      arguments: { text: 'hello' },
    }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('prompt text');
    expect(mockManagerGetPrompt.mock.calls.length).toBe(1);
  });

  it('returns err when no dispatch context', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
      name: 'search',
    });
    expect(result.ok).toBe(false);
  });

  it('returns err when skill has no MCP config', async () => {
    mockGetMcpConfig.mockImplementationOnce(async () => ok(null));

    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
      name: 'search',
    }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('no embedded MCP config');
  });

  it('returns err when mcp_name not found in skill config', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'nonexistent',
      operation: 'call_tool',
      name: 'search',
    }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not found in skill');
  });

  it('returns err when call_tool is called without a name', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
    }, ctx);

    expect(result.ok).toBe(false);
  });

  it('passes workspaceId and skillId to getMcpConfig', async () => {
    await skillMcp.handler({
      skill_id: 'skill-xyz',
      mcp_name: 'analytics',
      operation: 'list_tools',
    }, ctx);

    expect(mockGetMcpConfig.mock.calls[0]).toEqual(['ws-1', 'skill-xyz']);
  });

  it('returns err when getMcpConfig returns a service error', async () => {
    mockGetMcpConfig.mockImplementationOnce(async () =>
      err(new Error('DB unavailable'))
    );

    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'list_tools',
    }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('DB unavailable');
  });

  it('returns err when read_resource is called without a name', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'read_resource',
    }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('resource URI');
  });

  it('returns err when get_prompt is called without a name', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'get_prompt',
    }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('prompt name');
  });

  it('passes correct args to manager.callTool', async () => {
    await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
      name: 'search',
      arguments: { q: 'foo', limit: 10 },
    }, ctx);

    const [wsId, skillId, mcpName, , toolName, toolArgs] = mockManagerCallTool.mock.calls[0];
    expect(wsId).toBe('ws-1');
    expect(skillId).toBe('skill-abc');
    expect(mcpName).toBe('analytics');
    expect(toolName).toBe('search');
    expect(toolArgs).toEqual({ q: 'foo', limit: 10 });
  });
});
