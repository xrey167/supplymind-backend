export interface ExecuteOptions {
  /** If true, skip per-skill concurrency limit. */
  concurrencySafe?: boolean;
  /** Override timeout for this call. */
  timeoutMs?: number;
}

export class SkillExecutor {
  maxGlobalConcurrency = 20;
  maxPerSkillConcurrency = 5;
  defaultTimeoutMs = 30_000;
  perSkillTimeouts: Map<string, number> = new Map();

  private activeGlobal = 0;
  private activePerSkill: Map<string, number> = new Map();

  async execute<T>(skillId: string, fn: () => Promise<T>, opts?: ExecuteOptions & { workspaceId?: string; pluginId?: string }): Promise<T> {
    const perSkill = this.activePerSkill.get(skillId) ?? 0;

    if (this.activeGlobal >= this.maxGlobalConcurrency) {
      throw new Error(`Global concurrency limit (${this.maxGlobalConcurrency}) exceeded`);
    }
    if (!opts?.concurrencySafe && perSkill >= this.maxPerSkillConcurrency) {
      throw new Error(`Per-skill concurrency limit (${this.maxPerSkillConcurrency}) exceeded for ${skillId}`);
    }

    this.activeGlobal++;
    this.activePerSkill.set(skillId, perSkill + 1);

    const timeoutMs = opts?.timeoutMs ?? this.perSkillTimeouts.get(skillId) ?? this.defaultTimeoutMs;
    const start = Date.now();

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Skill ${skillId} timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      this.emitPerformance(skillId, Date.now() - start, true, opts);
      return result;
    } catch (err) {
      this.emitPerformance(skillId, Date.now() - start, false, opts, err instanceof Error ? err.message : String(err));
      throw err;
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

  private emitPerformance(
    skillId: string,
    durationMs: number,
    success: boolean,
    opts?: { workspaceId?: string; pluginId?: string },
    error?: string,
  ) {
    try {
      const { eventBus } = require('../../events/bus');
      const { Topics } = require('../../events/topics');
      eventBus.publish(Topics.SKILL_PERFORMANCE_RECORDED, {
        skillId,
        durationMs,
        success,
        workspaceId: opts?.workspaceId,
        pluginId: opts?.pluginId,
        error,
      });
    } catch {
      // Swallow — performance tracking is non-critical
    }
  }
}

/**
 * Partition tool calls into concurrent-safe and exclusive batches.
 * Concurrent-safe calls run in parallel; exclusive calls run sequentially.
 */
export function partitionToolCalls<T extends { concurrencySafe?: boolean }>(
  calls: T[],
): { concurrent: T[]; exclusive: T[] } {
  const concurrent: T[] = [];
  const exclusive: T[] = [];
  for (const call of calls) {
    if (call.concurrencySafe) concurrent.push(call);
    else exclusive.push(call);
  }
  return { concurrent, exclusive };
}

export const skillExecutor = new SkillExecutor();
