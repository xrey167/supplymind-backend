import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { skillRegistry } from './skills.registry';
import { BuiltinSkillProvider } from './providers/builtin.provider';
import { skillsRepo } from './skills.repo';
import { toolsService } from '../tools/tools.service';
import { dispatchSkill } from './skills.dispatch';
import type { Skill, DispatchContext } from './skills.types';

export class SkillsService {
  async loadSkills(): Promise<void> {
    // Load builtin skills
    const builtinProvider = new BuiltinSkillProvider();
    await skillRegistry.loadFromProviders([builtinProvider]);

    // Load DB-persisted skills and register as placeholder skills
    const globalDefs = await skillsRepo.findGlobal();
    for (const row of globalDefs) {
      if (!row.enabled) continue;
      const skill = toolsService.toSkill({
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        description: row.description,
        providerType: row.providerType!,
        priority: row.priority ?? 0,
        inputSchema: (row.inputSchema as Record<string, unknown>) ?? {},
        handlerConfig: (row.handlerConfig as Record<string, unknown>) ?? {},
        enabled: row.enabled ?? true,
        createdAt: row.createdAt!,
        updatedAt: row.updatedAt!,
      });
      skillRegistry.register(skill);
    }
  }

  listSkills(): Skill[] {
    return skillRegistry.list();
  }

  describeSkill(name: string): Skill | undefined {
    return skillRegistry.get(name);
  }

  async invokeSkill(name: string, args: Record<string, unknown>, context: DispatchContext): Promise<Result<unknown>> {
    return dispatchSkill(name, args, context);
  }
}

export const skillsService = new SkillsService();
