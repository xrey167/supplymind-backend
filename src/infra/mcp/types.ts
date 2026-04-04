export interface McpServerConfig {
  id: string;
  workspaceId: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface McpToolManifest {
  serverName: string;
  tools: McpToolDef[];
  fetchedAt: number;
}
