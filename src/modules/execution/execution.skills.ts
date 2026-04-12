import { skillRegistry } from '../skills/skills.registry';
import { executionService } from './execution.service';
import { ok } from '../../core/result';
import type { Skill, DispatchContext } from '../skills/skills.types';

const executionSkills: Skill[] = [
  {
    id: 'execution.run_plan',
    name: 'run_plan',
    description: 'Run an execution plan by ID through the intent gate.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'The execution plan ID to run' },
      },
      required: ['planId'],
    },
    providerType: 'builtin',
    priority: 50,
    handler: async (args: Record<string, unknown>, context?: DispatchContext) => {
      const { planId } = args as { planId: string };
      const workspaceId = context?.workspaceId ?? 'default';
      const callerId = context?.callerId ?? 'system';
      const result = await executionService.run(workspaceId, planId, callerId);
      if (!result.ok) throw new Error(result.error.message);
      return ok(result.value);
    },
  },
  {
    id: 'execution.approve_plan',
    name: 'approve_plan',
    description: 'Approve a pending execution plan so it proceeds to orchestration.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'The execution plan ID awaiting approval' },
      },
      required: ['planId'],
    },
    providerType: 'builtin',
    priority: 50,
    handler: async (args: Record<string, unknown>, context?: DispatchContext) => {
      const { planId } = args as { planId: string };
      const workspaceId = context?.workspaceId ?? 'default';
      const callerId = context?.callerId ?? 'system';
      const result = await executionService.approve(workspaceId, planId, callerId);
      if (!result.ok) throw new Error(result.error.message);
      return ok(result.value);
    },
  },
];

export function registerExecutionSkills(): void {
  for (const skill of executionSkills) {
    skillRegistry.register(skill);
  }
}
