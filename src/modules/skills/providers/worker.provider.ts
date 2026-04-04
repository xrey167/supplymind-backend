import { ok, err } from '../../../core/result';
import { enqueueSkill } from '../../../infra/queue/bullmq';
import type { Skill, SkillProvider } from '../skills.types';

interface WorkerSkillConfig {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  queueName?: string; // defaults to skill-execution
  timeout?: number;
}

export class WorkerSkillProvider implements SkillProvider {
  type = 'worker' as const;
  priority = 20;
  private configs: WorkerSkillConfig[];

  constructor(configs: WorkerSkillConfig[]) {
    this.configs = configs;
  }

  async loadSkills(): Promise<Skill[]> {
    return this.configs.map(config => ({
      id: `worker_${config.name}`,
      name: config.name,
      description: `[Worker] ${config.description}`,
      inputSchema: config.inputSchema,
      providerType: 'worker' as const,
      priority: this.priority,
      handler: async (args) => {
        try {
          const result = await enqueueSkill(
            {
              skillId: config.name,
              args: (args ?? {}) as Record<string, unknown>,
              workspaceId: 'system', // Will be overridden by dispatch context
              callerId: 'worker-provider',
            },
            { timeout: config.timeout ?? 30_000 },
          );
          if (result.success) return ok(result.value);
          return err(new Error(result.error ?? 'Worker job failed'));
        } catch (error) {
          return err(error instanceof Error ? error : new Error(String(error)));
        }
      },
    }));
  }
}
