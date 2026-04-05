import { ok, err } from '../../../core/result';
import type { Skill, SkillProvider } from '../skills.types';
import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';
import { createInputRequest } from '../../../infra/state/task-inputs';

export class BuiltinSkillProvider implements SkillProvider {
  type = 'builtin' as const;
  priority = 10;

  async loadSkills(): Promise<Skill[]> {
    return [
      {
        id: 'builtin:echo',
        name: 'echo',
        description: 'Returns the input arguments as a JSON string',
        inputSchema: { type: 'object', additionalProperties: true },
        providerType: 'builtin',
        priority: this.priority,
        handler: async (args) => ok(JSON.stringify(args)),
      },
      {
        id: 'builtin:get_time',
        name: 'get_time',
        description: 'Returns the current ISO timestamp',
        inputSchema: { type: 'object', properties: {} },
        providerType: 'builtin',
        priority: this.priority,
        handler: async () => ok(new Date().toISOString()),
      },
      {
        id: 'builtin:health_check',
        name: 'health_check',
        description: 'Returns a health check status',
        inputSchema: { type: 'object', properties: {} },
        providerType: 'builtin',
        priority: this.priority,
        handler: async () => ok({ status: 'ok', timestamp: new Date().toISOString() }),
      },
      {
        id: 'builtin:request_user_input',
        name: 'request_user_input',
        description: 'Pause execution and ask the user a question. Returns their response.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question to ask the user' },
            taskId: { type: 'string', description: 'The task requesting input' },
          },
          required: ['prompt', 'taskId'],
        },
        providerType: 'builtin',
        priority: this.priority,
        handler: async (args, ctx) => {
          const prompt = args.prompt as string;
          const taskId = args.taskId as string;
          const workspaceId = ctx?.workspaceId ?? 'default';

          // Publish input_required event so the UI knows to prompt the user
          eventBus.publish(Topics.TASK_INPUT_REQUIRED, {
            taskId,
            workspaceId,
            prompt,
          });

          const { taskRepo } = await import('../../../infra/a2a/task-repo');
          await taskRepo.updateStatus(taskId, 'input_required');

          // Wait for user input (5 minute timeout)
          const input = await createInputRequest(taskId, workspaceId, prompt, 5 * 60 * 1000);

          if (input === null) {
            return err(new Error('User input request timed out'));
          }

          await taskRepo.updateStatus(taskId, 'working');
          return ok(input);
        },
      },
    ];
  }
}
