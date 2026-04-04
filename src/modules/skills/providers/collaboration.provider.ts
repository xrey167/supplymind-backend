import { ok, err } from '../../../core/result';
import { collaborate } from '../../collaboration/collaboration.engine';
import { dispatchSkill } from '../skills.dispatch';
import type { Skill, SkillProvider } from '../skills.types';
import type { CollaborationRequest } from '../../collaboration/collaboration.types';

export class CollaborationSkillProvider implements SkillProvider {
  type = 'builtin' as const;
  priority = 10;

  async loadSkills(): Promise<Skill[]> {
    return [
      {
        id: 'builtin:collaborate',
        name: 'collaborate',
        description: 'Run multi-agent collaboration (fan_out, consensus, debate, map_reduce)',
        inputSchema: {
          type: 'object',
          properties: {
            strategy: { type: 'string', enum: ['fan_out', 'consensus', 'debate', 'map_reduce'] },
            query: { type: 'string' },
            agents: { type: 'array', items: { type: 'string' } },
            judgeAgent: { type: 'string' },
            maxRounds: { type: 'number' },
            convergenceThreshold: { type: 'number' },
            timeoutMs: { type: 'number' },
            items: { type: 'array', items: { type: 'string' } },
            mergeStrategy: { type: 'string', enum: ['concat', 'best_score', 'majority_vote', 'custom'] },
          },
          required: ['strategy', 'query', 'agents'],
        },
        providerType: 'builtin',
        priority: this.priority,
        handler: async (args) => {
          try {
            const req = args as CollaborationRequest;
            // Create a dispatch fn that routes through skill dispatch
            const dispatch = async (skillId: string, skillArgs: Record<string, unknown>): Promise<string> => {
              const result = await dispatchSkill(skillId, skillArgs, {
                callerId: 'collaboration-engine',
                workspaceId: 'default', // TODO: pass from context
                callerRole: 'agent',
              });
              if (!result.ok) throw new Error(result.error.message);
              return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
            };
            const result = await collaborate(req, dispatch);
            return ok(result);
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        },
      },
    ];
  }
}
