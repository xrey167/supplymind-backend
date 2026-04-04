import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { toolsRepo } from './tools.repo';
import { toToolDef } from './tools.mapper';
import { toolRegistry } from './tools.registry';
import type { ToolDef, CreateToolInput, UpdateToolInput } from './tools.types';
import type { DispatchContext } from '../skills/skills.types';
import { mcpClientPool } from '../../infra/mcp/client-pool';
import { enqueueSkill } from '../../infra/queue/bullmq';
import { logger } from '../../config/logger';

export class ToolsService {
  private createHandler(tool: ToolDef): (args: Record<string, unknown>, ctx?: DispatchContext) => Promise<Result<unknown>> {
    switch (tool.providerType) {
      case 'builtin':
        // Builtins are registered by BuiltinSkillProvider, DB tools with 'builtin' type just pass through
        return async (args) => ok(args);

      case 'mcp': {
        // handlerConfig should have { serverName: string, toolName: string }
        const { serverName, toolName } = tool.handlerConfig as { serverName: string; toolName: string };
        return async (args) => {
          try {
            const result = await mcpClientPool.callTool(serverName, toolName, args);
            return ok(result);
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }

      case 'worker': {
        // handlerConfig should have { queueName?: string, timeout?: number }
        const { timeout = 30_000 } = tool.handlerConfig as { queueName?: string; timeout?: number };
        return async (args, ctx) => {
          try {
            const result = await enqueueSkill(
              { skillId: tool.name, args, workspaceId: ctx?.workspaceId ?? 'system', callerId: ctx?.callerId ?? 'tool-service' },
              { timeout },
            );
            if (result.success) return ok(result.value);
            return err(new Error(result.error ?? 'Worker job failed'));
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }

      case 'inline': {
        // handlerConfig should have { code: string } — a JS function body executed only when code is trusted/admin-created
        return async (args) => {
          logger.warn({ toolId: tool.id, toolName: tool.name }, 'Inline tool execution — ensure code is trusted');
          try {
            // nosec: inline tools are admin-defined; sandboxing is the responsibility of the deployment environment
            // eslint-disable-next-line no-new-func
            const fn = new Function('args', tool.handlerConfig.code as string);
            const result = await fn(args);
            return ok(result);
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }

      case 'plugin':
        // Plugin provider loads dynamically — for DB-defined plugin tools, return stub
        return async () => err(new Error(`Plugin handler for "${tool.name}" must be loaded via plugin provider`));

      default:
        return async () => err(new Error(`Unknown provider type: ${tool.providerType}`));
    }
  }

  async list(workspaceId?: string): Promise<ToolDef[]> {
    const rows = await toolsRepo.findByWorkspace(workspaceId);
    return rows.map(toToolDef);
  }

  async getById(id: string): Promise<Result<ToolDef>> {
    const row = await toolsRepo.findById(id);
    if (!row) return err(new Error(`Tool not found: ${id}`));
    return ok(toToolDef(row));
  }

  async create(input: CreateToolInput): Promise<Result<ToolDef>> {
    const row = await toolsRepo.create(input);
    const tool = toToolDef(row);

    // Register in ToolRegistry (auto-syncs to SkillRegistry)
    toolRegistry.register({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: 'db',
      priority: tool.priority,
      enabled: tool.enabled,
      handler: this.createHandler(tool),
    });

    return ok(tool);
  }

  async update(id: string, input: UpdateToolInput): Promise<Result<ToolDef>> {
    const row = await toolsRepo.update(id, input);
    if (!row) return err(new Error(`Tool not found: ${id}`));
    const tool = toToolDef(row);

    // Re-register with updated definition
    toolRegistry.register({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: 'db',
      priority: tool.priority,
      enabled: tool.enabled,
      handler: this.createHandler(tool),
    });

    return ok(tool);
  }

  async remove(id: string): Promise<void> {
    // Find tool name before removing from DB
    const row = await toolsRepo.findById(id);
    if (row) {
      toolRegistry.unregister(row.name);
    }
    await toolsRepo.remove(id);
  }

  /** Load all enabled tool definitions from DB and register them in the tool registry. */
  async loadToolsFromDb(workspaceId?: string): Promise<ToolDef[]> {
    const tools = await this.list(workspaceId);
    for (const tool of tools) {
      if (!tool.enabled) continue;
      toolRegistry.register({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        source: 'db',
        priority: tool.priority,
        enabled: tool.enabled,
        handler: this.createHandler(tool),
      });
    }
    logger.info({ count: tools.length }, 'Loaded tools from DB into registry');
    return tools;
  }
}

export const toolsService = new ToolsService();
