export class SkillExecutor {
  maxGlobalConcurrency = 20;
  maxPerSkillConcurrency = 5;
  defaultTimeoutMs = 30_000;
  perSkillTimeouts: Map<string, number> = new Map();

  private activeGlobal = 0;
  private activePerSkill: Map<string, number> = new Map();

  async execute<T>(skillId: string, fn: () => Promise<T>): Promise<T> {
    const perSkill = this.activePerSkill.get(skillId) ?? 0;

    if (this.activeGlobal >= this.maxGlobalConcurrency) {
      throw new Error(`Global concurrency limit (${this.maxGlobalConcurrency}) exceeded`);
    }
    if (perSkill >= this.maxPerSkillConcurrency) {
      throw new Error(`Per-skill concurrency limit (${this.maxPerSkillConcurrency}) exceeded for ${skillId}`);
    }

    this.activeGlobal++;
    this.activePerSkill.set(skillId, perSkill + 1);

    const timeoutMs = this.perSkillTimeouts.get(skillId) ?? this.defaultTimeoutMs;

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Skill ${skillId} timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return result;
    } finally {
      this.activeGlobal--;
      const current = this.activePerSkill.get(skillId) ?? 1;
      if (current <= 1) {
        this.activePerSkill.delete(skillId);
      } else {
        this.activePerSkill.set(skillId, current - 1);
      }
    }
  }
}

export const skillExecutor = new SkillExecutor();
