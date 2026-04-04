import { ok, err } from '../../../core/result';
import { executeWorkflow } from '../../workflows/workflows.engine';
import { dispatchSkill } from '../skills.dispatch';
import type { Skill, SkillProvider } from '../skills.types';
import type { WorkflowDefinition } from '../../workflows/workflows.types';

export class WorkflowSkillProvider implements SkillProvider {
  type = 'builtin' as const;
  priority = 10;

  async loadSkills(): Promise<Skill[]> {
    return [
      {
        id: 'builtin:execute_workflow',
        name: 'execute_workflow',
        description: 'Execute a DAG-based workflow with steps, dependencies, and conditionals',
        inputSchema: {
          type: 'object',
          properties: {
            workflow: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                steps: { type: 'array' },
                maxConcurrency: { type: 'number' },
              },
              required: ['id', 'steps'],
            },
            input: { type: 'object' },
          },
          required: ['workflow'],
        },
        providerType: 'builtin',
        priority: this.priority,
        handler: async (args) => {
          try {
            const { workflow, input } = args as { workflow: WorkflowDefinition; input?: Record<string, unknown> };
            const dispatch = async (
              skillId: string,
              skillArgs: Record<string, unknown>,
              text: string,
            ): Promise<string> => {
              const result = await dispatchSkill(skillId, { ...skillArgs, text }, {
                callerId: 'workflow-engine',
                workspaceId: 'default', // TODO: pass from context
                callerRole: 'agent',
              });
              if (!result.ok) throw new Error(result.error.message);
              return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
            };
            const result = await executeWorkflow(workflow, dispatch, input);
            return ok(result);
          } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
          }
        },
      },
    ];
  }
}
