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
import { runInSandbox as defaultRunInSandbox } from '../../core/security/sandbox';
import type { runInSandbox as RunInSandboxFn } from '../../core/security/sandbox';
import { workspaceSettingsService } from '../settings/workspace-settings/workspace-settings.service';

export class ToolsService {
  private runInSandbox: typeof RunInSandboxFn;
  private registry: typeof toolRegistry;
  private pool: typeof mcpClientPool;

  constructor(sandboxFn?: typeof RunInSandboxFn, registry?: typeof toolRegistry, pool?: typeof mcpClientPool) {
    this.runInSandbox = sandboxFn ?? defaultRunInSandbox;
    this.registry = registry ?? toolRegistry;
    this.pool = pool ?? mcpClientPool;
  }

  private createHandler(tool: ToolDef): (args: unknown, ctx?: DispatchContext) => Promise<Result<unknown>> {
    switch (tool.providerType) {
      case 'builtin':
        // Builtins are handled by BuiltinSkillProvider — DB records with this type should not overwrite real handlers
        return async () => err(new Error(`Builtin tool "${tool.name}" must be provided by BuiltinSkillProvider, not DB handler`));

      case 'mcp': {
        const config = tool.handlerConfig as Extract<import('./tools.types').HandlerConfig, { type: 'mcp' }>;
        const { serverName, toolName } = config;
        return async (args) => {
          try {
            const result = await this.pool.callTool(serverName, toolName, args as Record<string, unknown>);
            return ok(result);
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }

      case 'worker': {
        const config = tool.handlerConfig as Extract<import('./tools.types').HandlerConfig, { type: 'worker' }>;
        const { timeout = 30_000 } = config;
        return async (args, ctx) => {
          try {
            const result = await enqueueSkill(
              { skillId: tool.name, args: args as Record<string, unknown>, workspaceId: ctx?.workspaceId ?? 'system', callerId: ctx?.callerId ?? 'tool-service' },
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
        return async (args, ctx) => {
          const workspaceId = ctx?.workspaceId;
          const policy = await workspaceSettingsService.getSandboxPolicy(workspaceId ?? 'default');
          const result = await this.runInSandbox({
            code: (tool.handlerConfig as Extract<import('./tools.types').HandlerConfig, { type: 'inline' }>).code,
            args,
            policy,
            toolId: tool.id,
            toolName: tool.name,
          });
          if (!result.ok) return err(result.error);
          return ok(result.value.value);
        };
      }

      case 'plugin':
        // Plugin provider loads dynamically — for DB-defined plugin tools, return stub
        return async () => err(new Error(`Plugin handler for "${tool.name}" must be loaded via plugin provider`));

      case 'agent': {
        const config = tool.handlerConfig as Extract<import('./tools.types').HandlerConfig, { type: 'agent' }>;
        return async (args, ctx) => {
          try {
            // Delegate to registered agent via worker registry
            const { workerRegistry } = await import('../../infra/a2a/worker-registry');
            const agentUrl = config.agentUrl;
            if (!agentUrl) return err(new Error(`Agent handler for "${tool.name}" requires agentUrl`));
            const result = await workerRegistry.delegate(agentUrl, { skillId: tool.name, args: args as Record<string, unknown> });
            return ok(result);
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }

      case 'tool': {
        const config = tool.handlerConfig as Extract<import('./tools.types').HandlerConfig, { type: 'tool' }>;
        return async (args, ctx) => {
          try {
            // Delegate to another skill in the registry
            const { skillRegistry } = await import('../skills/skills.registry');
            const mappedArgs = config.argsMapping
              ? Object.fromEntries(Object.entries(config.argsMapping).map(([to, from]) => [to, (args as any)[from]]))
              : args as Record<string, unknown>;
            return await skillRegistry.invoke(config.targetSkillName, mappedArgs, ctx!);
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }

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
    this.registry.register({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: 'db',
      priority: tool.priority,
      enabled: tool.enabled,
      handler: this.createHandler(tool),
      metadata: { providerType: tool.providerType },
    });

    return ok(tool);
  }

  async update(id: string, input: UpdateToolInput): Promise<Result<ToolDef>> {
    const row = await toolsRepo.update(id, input);
    if (!row) return err(new Error(`Tool not found: ${id}`));
    const tool = toToolDef(row);

    // Re-register with updated definition
    this.registry.register({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: 'db',
      priority: tool.priority,
      enabled: tool.enabled,
      handler: this.createHandler(tool),
      metadata: { providerType: tool.providerType },
    });

    return ok(tool);
  }

  async remove(id: string): Promise<void> {
    // Find tool name before removing from DB
    const row = await toolsRepo.findById(id);
    if (row) {
      this.registry.unregister(row.name);
    }
    await toolsRepo.remove(id);
  }

  /** Load all enabled tool definitions from DB and register them in the tool registry. */
  async loadToolsFromDb(workspaceId?: string): Promise<ToolDef[]> {
    const tools = await this.list(workspaceId);
    let registered = 0;
    for (const tool of tools) {
      if (!tool.enabled) continue;
      this.registry.register({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        source: 'db',
        priority: tool.priority,
        enabled: tool.enabled,
        handler: this.createHandler(tool),
        metadata: { providerType: tool.providerType },
      });
      registered++;
    }
    logger.info({ total: tools.length, registered }, 'Loaded tools from DB into registry');
    return tools;
  }
}

export const toolsService = new ToolsService();
