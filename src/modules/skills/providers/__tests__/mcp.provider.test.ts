import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { McpSkillProvider } from '../mcp.provider';
import { ok, err } from '../../../../core/result';
import type { McpServerConfig, McpToolManifest } from '../../../../infra/mcp/types';

// Re-export real McpClientPool via require+proxy to avoid contaminating client-pool.test.ts.
const _realClientPool = require('../../../../infra/mcp/client-pool');

let mockListTools: any;
let mockCallTool: any;

mock.module('../../../../infra/mcp/client-pool', () => ({
  ..._realClientPool,
  mcpClientPool: new Proxy(_realClientPool.mcpClientPool, {
    get(target: any, prop: string | symbol) {
      if (prop === 'listTools') return (config: any) => mockListTools(config);
      if (prop === 'callTool') return (configId: any, toolName: any, args: any) => mockCallTool(configId, toolName, args);
      return target[prop];
    },
  }),
}));

describe('McpSkillProvider', () => {
  const mockConfig: McpServerConfig = {
    id: 'github-server',
    workspaceId: 'workspace-1',
    name: 'github-mcp',
    transport: 'stdio',
    command: 'node',
    args: ['./github-mcp.js'],
    enabled: true,
  };

  const mockManifest: McpToolManifest = {
    serverName: 'github',
    tools: [
      {
        name: 'create_issue',
        description: 'Create an issue in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['owner', 'repo', 'title'],
        },
        serverName: 'github',
      },
      {
        name: 'list_issues',
        description: 'List issues in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
          },
          required: ['owner', 'repo'],
        },
        serverName: 'github',
      },
    ],
    fetchedAt: Date.now(),
  };

  beforeEach(() => {
    mockListTools = mock(() => Promise.resolve(mockManifest));
    mockCallTool = mock(() => Promise.resolve({ success: true }));
  });

  test('creates provider with correct type and priority', () => {
    const provider = new McpSkillProvider([mockConfig]);
    expect(provider.type).toBe('mcp');
    expect(provider.priority).toBe(15);
  });

  test('filters out disabled configs', async () => {
    const disabledConfig: McpServerConfig = {
      ...mockConfig,
      id: 'disabled-server',
      enabled: false,
    };

    const provider = new McpSkillProvider([mockConfig, disabledConfig]);
    await provider.loadSkills();

    expect(mockListTools.mock.calls.length).toBe(1);
    expect(mockListTools.mock.calls[0][0].id).toBe('github-server');
  });

  test('loads skills from MCP server', async () => {
    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe('github_create_issue');
    expect(skills[1].name).toBe('github_list_issues');
  });

  test('creates skill with correct structure', async () => {
    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();
    const createIssueSkill = skills[0];

    expect(createIssueSkill.id).toBe('mcp_github_create_issue');
    expect(createIssueSkill.name).toBe('github_create_issue');
    expect(createIssueSkill.description).toContain('[MCP:github]');
    expect(createIssueSkill.providerType).toBe('mcp');
    expect(createIssueSkill.priority).toBe(15);
    expect(createIssueSkill.inputSchema).toEqual(mockManifest.tools[0].inputSchema);
  });

  test('skill handler wraps callTool result in ok()', async () => {
    mockCallTool = mock(() => Promise.resolve({ result: 'issue-123' }));

    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({ owner: 'test', repo: 'repo', title: 'Test' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ result: 'issue-123' });
    }
  });

  test('skill handler wraps errors in err()', async () => {
    const testError = new Error('API limit exceeded');
    mockCallTool = mock(() => Promise.reject(testError));

    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({ owner: 'test', repo: 'repo', title: 'Test' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('API limit exceeded');
    }
  });

  test('skill handler converts non-Error rejections to Error', async () => {
    mockCallTool = mock(() => Promise.reject('string error'));

    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({ owner: 'test', repo: 'repo', title: 'Test' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('string error');
    }
  });

  test('skill handler handles null/undefined args', async () => {
    mockCallTool = mock(() => Promise.resolve({ success: true }));

    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    await handler(null as unknown as Record<string, unknown>);
    await handler(undefined as unknown as Record<string, unknown>);

    expect(mockCallTool.mock.calls.length).toBe(2);
    expect(mockCallTool.mock.calls[0][2]).toEqual({});
    expect(mockCallTool.mock.calls[1][2]).toEqual({});
  });

  test('skips unreachable servers and returns empty', async () => {
    mockListTools = mock(() => Promise.reject(new Error('Connection refused')));

    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(0);
  });

  test('continues loading from subsequent servers if one fails', async () => {
    const goodConfig: McpServerConfig = {
      id: 'github-server',
      workspaceId: 'workspace-1',
      name: 'github-mcp',
      transport: 'stdio',
      enabled: true,
    };

    const badConfig: McpServerConfig = {
      id: 'bad-server',
      workspaceId: 'workspace-1',
      name: 'bad-mcp',
      transport: 'stdio',
      enabled: true,
    };

    let callCount = 0;
    mockListTools = mock((config: McpServerConfig) => {
      callCount++;
      if (config.id === 'bad-server') {
        return Promise.reject(new Error('Connection failed'));
      }
      return Promise.resolve(mockManifest);
    });

    const provider = new McpSkillProvider([goodConfig, badConfig]);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(2);
    expect(callCount).toBe(2);
  });

  test('handlers call pool.callTool with correct params', async () => {
    mockCallTool = mock(() => Promise.resolve('result'));

    const provider = new McpSkillProvider([mockConfig]);
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;
    const testArgs = { owner: 'test', repo: 'repo', title: 'Test' };

    await handler(testArgs);

    expect(mockCallTool.mock.calls.length).toBe(1);
    const [configId, toolName, args] = mockCallTool.mock.calls[0];
    expect(configId).toBe('github-server');
    expect(toolName).toBe('create_issue');
    expect(args).toEqual(testArgs);
  });

  test('loads multiple servers and combines all skills', async () => {
    const config2: McpServerConfig = {
      id: 'slack-server',
      workspaceId: 'workspace-1',
      name: 'slack-mcp',
      transport: 'stdio',
      enabled: true,
    };

    const manifest2: McpToolManifest = {
      serverName: 'slack',
      tools: [
        {
          name: 'send_message',
          description: 'Send a message',
          inputSchema: { type: 'object' },
          serverName: 'slack',
        },
      ],
      fetchedAt: Date.now(),
    };

    let callCount = 0;
    mockListTools = mock((config: McpServerConfig) => {
      callCount++;
      if (config.id === 'slack-server') {
        return Promise.resolve(manifest2);
      }
      return Promise.resolve(mockManifest);
    });

    const provider = new McpSkillProvider([mockConfig, config2]);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(3);
    expect(skills[0].name).toBe('github_create_issue');
    expect(skills[1].name).toBe('github_list_issues');
    expect(skills[2].name).toBe('slack_send_message');
    expect(callCount).toBe(2);
  });

  test('skill name uses serverName from manifest not config.name', async () => {
    const config = {
      ...mockConfig,
      name: 'my-custom-name',
    };

    const provider = new McpSkillProvider([config]);
    const skills = await provider.loadSkills();

    expect(skills[0].name).toBe('github_create_issue');
    expect(skills[0].name).not.toContain('my-custom-name');
  });
});
