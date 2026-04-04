import { McpClient } from './client';
import type { McpServerConfig, McpToolManifest } from './types';

const MANIFEST_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class McpClientPool {
  private clients = new Map<string, McpClient>();
  private manifests = new Map<string, McpToolManifest>();

  async getOrConnect(config: McpServerConfig): Promise<McpClient> {
    let client = this.clients.get(config.id);
    if (client?.isConnected()) return client;

    client = new McpClient(config);
    await client.connect();
    this.clients.set(config.id, client);
    return client;
  }

  async listTools(config: McpServerConfig): Promise<McpToolManifest> {
    const cached = this.manifests.get(config.id);
    if (cached && Date.now() - cached.fetchedAt < MANIFEST_TTL_MS) {
      return cached;
    }

    const client = await this.getOrConnect(config);
    const tools = await client.listTools();
    const manifest: McpToolManifest = {
      serverName: config.name,
      tools,
      fetchedAt: Date.now(),
    };
    this.manifests.set(config.id, manifest);
    return manifest;
  }

  async callTool(configId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(configId);
    if (!client) throw new Error(`No MCP client for config: ${configId}`);
    return client.callTool(toolName, args);
  }

  async refreshAll(configs: McpServerConfig[]): Promise<void> {
    for (const config of configs) {
      if (config.enabled) {
        try {
          await this.listTools(config);
        } catch {
          // Skip unreachable servers
        }
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.disconnect();
      } catch {
        // Best-effort cleanup
      }
    }
    this.clients.clear();
    this.manifests.clear();
  }

  getAllManifests(): McpToolManifest[] {
    return Array.from(this.manifests.values());
  }
}

export const mcpClientPool = new McpClientPool();
