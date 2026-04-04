import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { toolsRepo } from './tools.repo';
import { toToolDef } from './tools.mapper';
import { toolRegistry } from './tools.registry';
import type { ToolDef, CreateToolInput, UpdateToolInput } from './tools.types';

export class ToolsService {
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
      handler: async (_args) => {
        return err(new Error(`Handler not implemented for provider type: ${tool.providerType}`));
      },
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
      handler: async (_args) => {
        return err(new Error(`Handler not implemented for provider type: ${tool.providerType}`));
      },
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

  /** Load all tool definitions from DB. Registration happens when providers resolve handlers. */
  async loadToolsFromDb(_workspaceId?: string): Promise<ToolDef[]> {
    return this.list(_workspaceId);
  }
}

export const toolsService = new ToolsService();
