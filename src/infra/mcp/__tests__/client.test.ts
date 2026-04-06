import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { McpResourceDef, McpPromptDef, SkillMcpConfig, SkillMcpServerEntry } from '../types';

describe('MCP types', () => {
  it('McpResourceDef has required fields', () => {
    const r: McpResourceDef = {
      uri: 'file:///data.json',
      name: 'data',
      description: 'some data',
      mimeType: 'application/json',
    };
    expect(r.uri).toBe('file:///data.json');
  });

  it('McpPromptDef has required fields', () => {
    const p: McpPromptDef = {
      name: 'summarize',
      description: 'summarize text',
      arguments: [{ name: 'text', description: 'Input text', required: true }],
    };
    expect(p.name).toBe('summarize');
  });

  it('SkillMcpConfig is a record of transport configs', () => {
    const c: SkillMcpConfig = {
      myServer: { type: 'streamable-http', url: 'http://localhost:3000' },
      anotherServer: { type: 'stdio', command: 'node', args: ['server.js'] },
    };
    expect(Object.keys(c)).toHaveLength(2);
  });

  it('SkillMcpServerEntry narrows correctly by type discriminant', () => {
    const entry: SkillMcpServerEntry = { type: 'stdio', command: 'node', args: ['server.js'] };
    if (entry.type === 'stdio') {
      expect(entry.command).toBe('node');
    } else {
      throw new Error('narrowing failed');
    }
  });
});

// ---- McpClient tests ----

const mockConnect = mock(async () => {});
const mockSdkListTools = mock(async () => ({ tools: [] }));
const mockSdkListResources = mock(async () => ({
  resources: [{ uri: 'file:///data', name: 'data', mimeType: 'text/plain' }],
}));
const mockSdkReadResource = mock(async () => ({
  contents: [{ uri: 'file:///data', text: 'hello world' }],
}));
const mockSdkListPrompts = mock(async () => ({
  prompts: [{ name: 'summarize', description: 'Summarize text' }],
}));
const mockSdkGetPrompt = mock(async () => ({
  description: 'Prompt result',
  messages: [{ role: 'user', content: { type: 'text', text: 'Summarize: foo bar' } }],
}));
const mockSdkCallTool = mock(async () => ({
  content: [{ type: 'text', text: 'ok' }],
}));
const mockClose = mock(async () => {});

// Capture constructor args to verify headers are passed
let lastStreamableHttpArgs: any[] = [];

mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    constructor() {}
    connect = mockConnect;
    listTools = mockSdkListTools;
    listResources = mockSdkListResources;
    readResource = mockSdkReadResource;
    listPrompts = mockSdkListPrompts;
    getPrompt = mockSdkGetPrompt;
    callTool = mockSdkCallTool;
    close = mockClose;
  },
}));
mock.module('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class { constructor(_opts: any) {} },
}));
mock.module('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class { constructor(_url: URL) {} },
}));
mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(...args: any[]) { lastStreamableHttpArgs = args; }
  },
}));

const { McpClient } = await import('../client');

const stdioConfig = {
  id: 'srv-1', workspaceId: 'ws-1', name: 'test',
  transport: 'stdio' as const, command: 'echo', args: [], enabled: true,
};

const httpConfig = {
  id: 'srv-2', workspaceId: 'ws-1', name: 'test-http',
  transport: 'streamable-http' as const,
  url: 'http://localhost:3000',
  headers: { Authorization: 'Bearer tok' },
  enabled: true,
};

describe('McpClient', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockSdkListTools.mockClear();
    mockSdkListResources.mockClear();
    mockSdkReadResource.mockClear();
    mockSdkListPrompts.mockClear();
    mockSdkGetPrompt.mockClear();
    mockSdkCallTool.mockClear();
    mockClose.mockClear();
    lastStreamableHttpArgs = [];
  });

  it('listResources returns mapped resources', async () => {
    const client = new McpClient(stdioConfig);
    const resources = await client.listResources();
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe('file:///data');
    expect(resources[0].name).toBe('data');
    expect(resources[0].mimeType).toBe('text/plain');
  });

  it('readResource returns joined text content', async () => {
    const client = new McpClient(stdioConfig);
    const text = await client.readResource('file:///data');
    expect(text).toBe('hello world');
  });

  it('listPrompts returns mapped prompts', async () => {
    const client = new McpClient(stdioConfig);
    const prompts = await client.listPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('summarize');
    expect(prompts[0].description).toBe('Summarize text');
  });

  it('getPrompt returns rendered message text', async () => {
    const client = new McpClient(stdioConfig);
    const result = await client.getPrompt('summarize', { text: 'foo bar' });
    expect(result).toContain('Summarize: foo bar');
  });

  it('lastUsedAt is updated after listTools', async () => {
    const client = new McpClient(stdioConfig);
    const before = client.lastUsedAt;
    await new Promise((r) => setTimeout(r, 5));
    await client.listTools();
    expect(client.lastUsedAt).toBeGreaterThan(before);
  });

  it('lastUsedAt is updated after listResources', async () => {
    const client = new McpClient(stdioConfig);
    const before = client.lastUsedAt;
    await new Promise((r) => setTimeout(r, 5));
    await client.listResources();
    expect(client.lastUsedAt).toBeGreaterThan(before);
  });

  it('passes headers to StreamableHTTPClientTransport', async () => {
    const client = new McpClient(httpConfig);
    await client.connect();
    expect(lastStreamableHttpArgs[1]).toBeDefined();
    expect(lastStreamableHttpArgs[1].requestInit.headers).toEqual({ Authorization: 'Bearer tok' });
  });
});
