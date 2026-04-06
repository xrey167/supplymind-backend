import { McpClient } from './client';
import type { McpServerConfig, McpToolManifest, McpResourceDef, McpPromptDef } from './types';

const MANIFEST_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

export class McpClientPool {
  private clients = new Map<string, McpClient>();
  private manifests = new Map<string, McpToolManifest>();

  private async getOrConnect(config: McpServerConfig): Promise<McpClient> {
    const existing = this.clients.get(config.id);
    if (existing?.isConnected()) return existing;

    const client = new McpClient(config);
    if (client.isConnected()) {
      this.clients.set(config.id, client);
      return client;
    }
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await client.connect();
        this.clients.set(config.id, client);
        return client;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
        }
      }
    }

    throw lastError;
  }

  async listTools(config: McpServerConfig): Promise<McpToolManifest> {
    const cached = this.manifests.get(config.id);
    if (cached && Date.now() - cached.fetchedAt < MANIFEST_TTL_MS) {
      return cached;
    }
    const client = await this.getOrConnect(config);
    const tools = await client.listTools();
    const manifest: McpToolManifest = { serverName: config.name, tools, fetchedAt: Date.now() };
    this.manifests.set(config.id, manifest);
    return manifest;
  }

  async callTool(configId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(configId);
    if (!client) throw new Error(`No MCP client for config: ${configId}`);
    return client.callTool(toolName, args);
  }

  async listResources(config: McpServerConfig): Promise<McpResourceDef[]> {
    const client = await this.getOrConnect(config);
    return client.listResources();
  }

  async readResource(configId: string, uri: string): Promise<string> {
    const client = this.clients.get(configId);
    if (!client) throw new Error(`No MCP client for config: ${configId}`);
    return client.readResource(uri);
  }

  async listPrompts(config: McpServerConfig): Promise<McpPromptDef[]> {
    const client = await this.getOrConnect(config);
    return client.listPrompts();
  }

  async getPrompt(configId: string, name: string, args?: Record<string, string>): Promise<string> {
    const client = this.clients.get(configId);
    if (!client) throw new Error(`No MCP client for config: ${configId}`);
    return client.getPrompt(name, args);
  }

  async refreshAll(configs: McpServerConfig[]): Promise<void> {
    for (const config of configs) {
      if (!config.enabled) continue;
      try { await this.listTools(config); } catch { /* skip unreachable */ }
    }
  }

  /** Disconnect clients idle longer than idleThresholdMs. Call on a timer. */
  cleanupIdle(idleThresholdMs: number): void {
    const now = Date.now();
    for (const [id, client] of this.clients) {
      if (now - client.lastUsedAt > idleThresholdMs) {
        client.disconnect().catch(() => {});
        this.clients.delete(id);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try { await client.disconnect(); } catch { /* best-effort */ }
    }
    this.clients.clear();
    this.manifests.clear();
  }

  getAllManifests(): McpToolManifest[] {
    return Array.from(this.manifests.values());
  }
}

export const mcpClientPool = new McpClientPool();
