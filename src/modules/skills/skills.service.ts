import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import type { SkillMcpConfigInput } from './skills.schemas';
import { skillRegistry } from './skills.registry';
import { BuiltinSkillProvider } from './providers/builtin.provider';
import { CollaborationSkillProvider } from './providers/collaboration.provider';
import { WorkflowSkillProvider } from './providers/workflow.provider';
import { skillsRepo } from './skills.repo';
import { toolsService } from '../tools/tools.service';
import { dispatchSkill } from './skills.dispatch';
import type { Skill, DispatchContext } from './skills.types';

export class SkillsService {
  async loadSkills(): Promise<void> {
    // Load builtin skills
    const builtinProvider = new BuiltinSkillProvider();
    const collaborationProvider = new CollaborationSkillProvider();
    const workflowProvider = new WorkflowSkillProvider();
    await skillRegistry.loadFromProviders([builtinProvider, collaborationProvider, workflowProvider]);

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

  async getMcpConfig(workspaceId: string, skillId: string): Promise<Result<SkillMcpConfigInput | null>> {
    try {
      const skill = await skillsRepo.findById(skillId);
      if (!skill) return err(new Error(`Skill not found: ${skillId}`));
      if (skill.workspaceId && skill.workspaceId !== workspaceId) {
        return err(new Error('Skill not found in this workspace'));
      }
      const config = await skillsRepo.getMcpConfig(skillId);
      return ok(config as SkillMcpConfigInput | null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async setMcpConfig(workspaceId: string, skillId: string, config: SkillMcpConfigInput): Promise<Result<void>> {
    try {
      const skill = await skillsRepo.findById(skillId);
      if (!skill) return err(new Error(`Skill not found: ${skillId}`));
      if (skill.workspaceId && skill.workspaceId !== workspaceId) {
        return err(new Error('Skill not found in this workspace'));
      }
      await skillsRepo.setMcpConfig(skillId, config as Record<string, unknown>);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

export const skillsService = new SkillsService();
