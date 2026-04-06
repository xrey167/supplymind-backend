export interface McpServerConfig {
  id: string;
  workspaceId: string | null;
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

export interface McpResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgDef {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDef {
  name: string;
  description?: string;
  arguments?: McpPromptArgDef[];
}

export interface McpToolManifest {
  serverName: string;
  tools: McpToolDef[];
  fetchedAt: number;
}

/** Inline MCP config carried by a skill — keyed by MCP name */
export type SkillMcpConfig = Record<string, SkillMcpServerEntry>;

export type SkillMcpServerEntry =
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> };
