import { logger } from '../../config/logger';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { skillRegistry } from '../skills/skills.registry';
import type { Skill, SkillToolHints } from '../skills/skills.types';
import type { Result } from '../../core/result';
import { ok, err } from '../../core/result';

export type ToolSource = 'builtin' | 'db' | 'plugin' | 'mcp' | 'inline';

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: ToolSource;
  pluginId?: string;
  priority: number;
  enabled: boolean;
  handler: (args: unknown) => Promise<Result<unknown>>;
  toolHints?: SkillToolHints;
  metadata?: Record<string, unknown>;
}

export interface ToolPlugin {
  id: string;
  name: string;
  version: string;
  loadTools(): Promise<Omit<RegisteredTool, 'source' | 'pluginId'>[]>;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private plugins = new Map<string, ToolPlugin>();

  register(tool: RegisteredTool): void {
    const existing = this.tools.get(tool.name);
    if (existing && existing.priority >= tool.priority) {
      return; // higher priority wins
    }
    this.tools.set(tool.name, tool);

    // Auto-sync to SkillRegistry if enabled
    if (tool.enabled) {
      this.syncToSkillRegistry(tool);
    }

    eventBus.publish(Topics.SKILL_REGISTERED, {
      toolId: tool.id,
      name: tool.name,
      source: tool.source,
      pluginId: tool.pluginId,
    });

    logger.debug({ name: tool.name, source: tool.source, pluginId: tool.pluginId }, 'Tool registered');
  }

  unregister(name: string): void {
    const tool = this.tools.get(name);
    if (!tool) return;
    this.tools.delete(name);
    skillRegistry.unregister(name);
    logger.debug({ name, source: tool.source }, 'Tool unregistered');
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(filter?: { source?: ToolSource; pluginId?: string; enabled?: boolean }): RegisteredTool[] {
    let tools = Array.from(this.tools.values());
    if (filter?.source) tools = tools.filter(t => t.source === filter.source);
    if (filter?.pluginId) tools = tools.filter(t => t.pluginId === filter.pluginId);
    if (filter?.enabled !== undefined) tools = tools.filter(t => t.enabled === filter.enabled);
    return tools;
  }

  enable(name: string): void {
    const tool = this.tools.get(name);
    if (!tool || tool.enabled) return;
    tool.enabled = true;
    this.syncToSkillRegistry(tool);
  }

  disable(name: string): void {
    const tool = this.tools.get(name);
    if (!tool || !tool.enabled) return;
    tool.enabled = false;
    skillRegistry.unregister(name);
  }

  /** Register a plugin and load its tools */
  async registerPlugin(plugin: ToolPlugin): Promise<void> {
    this.plugins.set(plugin.id, plugin);
    try {
      const tools = await plugin.loadTools();
      for (const tool of tools) {
        this.register({
          ...tool,
          source: 'plugin',
          pluginId: plugin.id,
        });
      }
      logger.info({ pluginId: plugin.id, name: plugin.name, toolCount: tools.length }, 'Plugin registered');
    } catch (error) {
      logger.error({ pluginId: plugin.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to load plugin tools');
      throw error;
    }
  }

  /** Unregister a plugin and all its tools */
  unregisterPlugin(pluginId: string): void {
    const pluginTools = this.list({ pluginId });
    for (const tool of pluginTools) {
      this.unregister(tool.name);
    }
    this.plugins.delete(pluginId);
    logger.info({ pluginId, removedTools: pluginTools.length }, 'Plugin unregistered');
  }

  getPlugin(pluginId: string): ToolPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  listPlugins(): ToolPlugin[] {
    return Array.from(this.plugins.values());
  }

  private syncToSkillRegistry(tool: RegisteredTool): void {
    const providerType = tool.source === 'db' ? 'inline'
      : tool.source === 'plugin' ? 'plugin'
      : tool.source === 'mcp' ? 'mcp'
      : tool.source === 'builtin' ? 'builtin'
      : 'inline';

    const skill: Skill = {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      providerType,
      priority: tool.priority,
      handler: tool.handler,
      toolHints: tool.toolHints,
    };
    skillRegistry.register(skill);
  }

  clear(): void {
    for (const name of this.tools.keys()) {
      skillRegistry.unregister(name);
    }
    this.tools.clear();
    this.plugins.clear();
  }
}

export const toolRegistry = new ToolRegistry();
