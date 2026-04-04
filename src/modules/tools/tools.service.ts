import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { toolsRepo } from './tools.repo';
import { toToolDef } from './tools.mapper';
import type { ToolDef, CreateToolInput, UpdateToolInput } from './tools.types';
import type { Skill } from '../skills/skills.types';

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
    eventBus.emit(Topics.SKILL_REGISTERED, {
      toolId: tool.id,
      workspaceId: tool.workspaceId,
      name: tool.name,
    });
    return ok(tool);
  }

  async update(id: string, input: UpdateToolInput): Promise<Result<ToolDef>> {
    const row = await toolsRepo.update(id, input);
    if (!row) return err(new Error(`Tool not found: ${id}`));
    const tool = toToolDef(row);
    return ok(tool);
  }

  async remove(id: string): Promise<void> {
    await toolsRepo.remove(id);
  }

  toSkill(def: ToolDef): Skill {
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      providerType: def.providerType as Skill['providerType'],
      priority: def.priority,
      handler: async (_args) => {
        if (def.providerType === 'builtin') {
          return err(new Error(`Builtin tool ${def.name} should be loaded via BuiltinSkillProvider`));
        }
        return err(new Error(`Handler not implemented for provider type: ${def.providerType}`));
      },
    };
  }
}

export const toolsService = new ToolsService();
