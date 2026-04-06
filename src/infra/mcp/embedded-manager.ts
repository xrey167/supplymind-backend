import { McpClient } from './client';
import type { SkillMcpServerEntry, McpToolDef, McpResourceDef, McpPromptDef } from './types';

/**
 * Manages lazy MCP client connections scoped to individual skills.
 * Pool key: `${workspaceId}:${skillId}:${mcpName}`
 *
 * Clients are only created and connected when a skill operation first requires them.
 * Different skills get isolated connections to the same MCP server.
 */
export class SkillEmbeddedMcpManager {
  private clients = new Map<string, McpClient>();

  private poolKey(workspaceId: string, skillId: string, mcpName: string): string {
    return `${workspaceId}:${skillId}:${mcpName}`;
  }

  private entryToConfig(mcpName: string, entry: SkillMcpServerEntry) {
    return {
      id: mcpName,
      workspaceId: null as string | null,
      name: mcpName,
      transport: entry.type === 'stdio' ? 'stdio' as const
               : entry.type === 'sse'   ? 'sse' as const
               : 'streamable-http' as const,
      url:     (entry as any).url,
      command: (entry as any).command,
      args:    (entry as any).args,
      env:     (entry as any).env,
      headers: (entry as any).headers,
      enabled: true,
    };
  }

  private async getOrCreate(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpClient> {
    const key = this.poolKey(workspaceId, skillId, mcpName);
    const existing = this.clients.get(key);
    if (existing?.isConnected()) return existing;

    const config = this.entryToConfig(mcpName, entry);
    const client = new McpClient(config as any);
    await client.connect();
    this.clients.set(key, client);
    return client;
  }

  async listTools(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpToolDef[]> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.listTools();
  }

  async callTool(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.callTool(toolName, args);
  }

  async listResources(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpResourceDef[]> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.listResources();
  }

  async readResource(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
    uri: string,
  ): Promise<string> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.readResource(uri);
  }

  async listPrompts(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpPromptDef[]> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.listPrompts();
  }

  async getPrompt(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<string> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.getPrompt(promptName, args);
  }

  /** Disconnect clients idle longer than idleThresholdMs. */
  cleanupIdle(idleThresholdMs: number): void {
    const now = Date.now();
    for (const [key, client] of this.clients) {
      if (now - client.lastUsedAt >= idleThresholdMs) {
        client.disconnect().catch(() => {});
        this.clients.delete(key);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try { await client.disconnect(); } catch { /* best-effort */ }
    }
    this.clients.clear();
  }

  /** Active client count — for monitoring. */
  activeCount(): number {
    return this.clients.size;
  }
}

export const skillEmbeddedMcpManager = new SkillEmbeddedMcpManager();
