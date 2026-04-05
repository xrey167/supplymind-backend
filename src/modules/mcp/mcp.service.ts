import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { logger } from '../../config/logger';
import { mcpClientPool } from '../../infra/mcp/client-pool';
import type { McpServerConfig } from '../../infra/mcp/types';
import { skillRegistry } from '../skills/skills.registry';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { mcpRepo } from './mcp.repo';
import type { McpServerRow, CreateMcpData } from './mcp.repo';
import type { CreateMcpInput, UpdateMcpInput } from './mcp.schemas';

/**
 * Map a DB row to the McpServerConfig expected by mcpClientPool.
 * Casts JSONB columns (args, env, headers) to their proper types.
 */
function toMcpServerConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    transport: row.transport as McpServerConfig['transport'],
    url: row.url ?? undefined,
    command: row.command ?? undefined,
    args: (row.args as string[] | null) ?? undefined,
    env: (row.env as Record<string, string> | null) ?? undefined,
    headers: (row.headers as Record<string, string> | null) ?? undefined,
    enabled: row.enabled ?? true,
  };
}

export class McpService {
  private loadedWorkspaces = new Set<string>();

  /**
   * Called at bootstrap — load global (workspaceId IS NULL) MCP servers.
   */
  async loadGlobalServers(): Promise<void> {
    const configs = await mcpRepo.findGlobal();
    await this.loadConfigs(configs);
  }

  /**
   * Called per workspace — idempotent (skips if already loaded for this workspace).
   */
  async ensureWorkspaceLoaded(workspaceId: string): Promise<void> {
    if (this.loadedWorkspaces.has(workspaceId)) return;
    this.loadedWorkspaces.add(workspaceId);
    const configs = await mcpRepo.findByWorkspace(workspaceId);
    await this.loadConfigs(configs);
  }

  private async loadConfigs(configs: McpServerRow[]): Promise<void> {
    const enabled = configs.filter((c) => c.enabled);
    for (const config of enabled) {
      try {
        const mcpConfig = toMcpServerConfig(config);
        const manifest = await mcpClientPool.listTools(mcpConfig);
        for (const tool of manifest.tools) {
          skillRegistry.register({
            id: `mcp:${config.name}:${tool.name}`,
            name: `mcp_${config.name}_${tool.name}`,
            description: `[MCP:${config.name}] ${tool.description}`,
            inputSchema: tool.inputSchema,
            providerType: 'mcp',
            priority: 15,
            handler: async (args) => {
              try {
                const result = await mcpClientPool.callTool(
                  config.id,
                  tool.name,
                  (args ?? {}) as Record<string, unknown>,
                );
                return ok(result);
              } catch (error) {
                return err(error instanceof Error ? error : new Error(String(error)));
              }
            },
          });
        }
        eventBus.publish(Topics.MCP_TOOLS_DISCOVERED, {
          serverId: config.id,
          serverName: config.name,
          toolCount: manifest.tools.length,
        });
      } catch (error) {
        logger.warn(
          { err: error, configId: config.id, name: config.name },
          'Failed to load MCP server',
        );
      }
    }
  }

  async list(workspaceId: string): Promise<Result<McpServerRow[]>> {
    try {
      const rows = await mcpRepo.findByWorkspace(workspaceId);
      return ok(rows);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async create(workspaceId: string, data: CreateMcpInput): Promise<Result<McpServerRow>> {
    try {
      const row = await mcpRepo.create({
        workspaceId,
        name: data.name,
        transport: data.transport,
        url: data.url ?? null,
        command: data.command ?? null,
        args: data.args ?? null,
        env: data.env ?? null,
        headers: data.headers ?? null,
        enabled: data.enabled,
      } as CreateMcpData);
      return ok(row);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async update(workspaceId: string, id: string, data: UpdateMcpInput): Promise<Result<McpServerRow>> {
    try {
      const existing = await mcpRepo.findById(id);
      if (!existing) return err(new Error(`MCP server not found: ${id}`));
      if (existing.workspaceId !== workspaceId) return err(new Error('MCP server not found in this workspace'));

      const updated = await mcpRepo.update(id, data as Partial<McpServerRow>);
      if (!updated) return err(new Error(`Failed to update MCP server: ${id}`));
      return ok(updated);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async remove(workspaceId: string, id: string): Promise<Result<void>> {
    try {
      const existing = await mcpRepo.findById(id);
      if (!existing) return err(new Error(`MCP server not found: ${id}`));
      if (existing.workspaceId !== workspaceId) return err(new Error('MCP server not found in this workspace'));

      await mcpRepo.remove(id);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async testConnection(workspaceId: string, id: string): Promise<Result<{ tools: string[] }>> {
    try {
      const existing = await mcpRepo.findById(id);
      if (!existing) return err(new Error(`MCP server not found: ${id}`));
      if (existing.workspaceId !== workspaceId) return err(new Error('MCP server not found in this workspace'));

      const mcpConfig = toMcpServerConfig(existing);
      const manifest = await mcpClientPool.listTools(mcpConfig);
      return ok({ tools: manifest.tools.map((t) => t.name) });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Reset the loaded workspaces set — used in tests. */
  _resetLoadedWorkspaces(): void {
    this.loadedWorkspaces.clear();
  }
}

export const mcpService = new McpService();
