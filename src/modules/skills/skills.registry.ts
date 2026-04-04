import { err } from '../../core/result';
import type { Result } from '../../core/result';
import type { ToolDefinition } from '../../infra/ai/types';
import type { Skill, SkillProvider } from './skills.types';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill): void {
    const existing = this.skills.get(skill.name);
    if (existing && existing.priority >= skill.priority) {
      return;
    }
    this.skills.set(skill.name, skill);
  }

  unregister(name: string): void {
    this.skills.delete(name);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  async invoke(name: string, args: unknown): Promise<Result<unknown>> {
    const skill = this.skills.get(name);
    if (!skill) {
      return err(new Error(`Skill not found: ${name}`));
    }
    try {
      return await skill.handler(args);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async loadFromProviders(providers: SkillProvider[]): Promise<void> {
    for (const provider of providers) {
      const skills = await provider.loadSkills();
      for (const skill of skills) {
        this.register(skill);
      }
    }
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.list().map((skill) => ({
      name: skill.name,
      description: skill.description,
      inputSchema: skill.inputSchema,
      ...(skill.toolHints?.strict != null && { strict: skill.toolHints.strict }),
      ...(skill.toolHints?.cacheable && { cacheControl: { type: 'ephemeral' as const } }),
      ...(skill.toolHints?.eagerInputStreaming != null && { eagerInputStreaming: skill.toolHints.eagerInputStreaming }),
    }));
  }

  clear(): void {
    this.skills.clear();
  }
}

export const skillRegistry = new SkillRegistry();
