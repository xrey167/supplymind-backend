import { ok, err } from '../../../core/result';
import type { Skill, SkillProvider } from '../skills.types';
import { logger } from '../../../config/logger';
import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';
import { createInputRequest } from '../../../infra/state/task-inputs';
import { skillsService } from '../skills.service';
import { skillEmbeddedMcpManager } from '../../../infra/mcp/embedded-manager';

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
      {
        id: 'builtin:skill_mcp',
        name: 'skill_mcp',
        description: 'Call a tool, read a resource, or get a prompt from an MCP server embedded in a specific skill. Use the list_tools operation to discover what the MCP offers before calling.',
        inputSchema: {
          type: 'object',
          properties: {
            skill_id: {
              type: 'string',
              description: 'ID of the skill that owns this MCP server',
            },
            mcp_name: {
              type: 'string',
              description: 'Name of the embedded MCP server (as declared in the skill\'s MCP config)',
            },
            operation: {
              type: 'string',
              enum: ['call_tool', 'read_resource', 'get_prompt', 'list_tools'],
              description: 'Operation to perform: call a tool, read a resource URI, get a rendered prompt, or list available tools',
            },
            name: {
              type: 'string',
              description: 'Tool name, resource URI, or prompt name — required for all operations except list_tools',
            },
            arguments: {
              type: 'object',
              additionalProperties: true,
              description: 'Arguments passed to call_tool or get_prompt',
            },
          },
          required: ['skill_id', 'mcp_name', 'operation'],
        },
        providerType: 'builtin',
        priority: this.priority,
        concurrencySafe: true,
        handler: async (args, context) => {
          if (!context?.workspaceId) {
            return err(new Error('skill_mcp requires a dispatch context with workspaceId'));
          }

          const skillId = args.skill_id as string;
          const mcpName = args.mcp_name as string;
          const operation = args.operation as 'call_tool' | 'read_resource' | 'get_prompt' | 'list_tools';
          const name = args.name as string | undefined;
          const callArgs = (args.arguments ?? {}) as Record<string, unknown>;
          const { workspaceId } = context;

          const configResult = await skillsService.getMcpConfig(workspaceId, skillId);
          if (!configResult.ok) return configResult;

          if (!configResult.value) {
            return err(new Error(`Skill '${skillId}' has no embedded MCP config`));
          }

          const mcpEntry = configResult.value[mcpName];
          if (!mcpEntry) {
            const available = Object.keys(configResult.value).join(', ') || '(none)';
            return err(new Error(`MCP '${mcpName}' not found in skill '${skillId}'. Available: ${available}`));
          }

          try {
            switch (operation) {
              case 'list_tools': {
                const tools = await skillEmbeddedMcpManager.listTools(workspaceId, skillId, mcpName, mcpEntry);
                return ok(tools);
              }
              case 'call_tool': {
                if (!name) return err(new Error('call_tool requires a tool name'));
                const result = await skillEmbeddedMcpManager.callTool(workspaceId, skillId, mcpName, mcpEntry, name, callArgs);
                return ok(result);
              }
              case 'read_resource': {
                if (!name) return err(new Error('read_resource requires a resource URI as name'));
                const text = await skillEmbeddedMcpManager.readResource(workspaceId, skillId, mcpName, mcpEntry, name);
                return ok(text);
              }
              case 'get_prompt': {
                if (!name) return err(new Error('get_prompt requires a prompt name'));
                const text = await skillEmbeddedMcpManager.getPrompt(
                  workspaceId, skillId, mcpName, mcpEntry, name,
                  callArgs as Record<string, string>,
                );
                return ok(text);
              }
              default:
                return err(new Error(`Unknown operation: ${String(operation)}`));
            }
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error({ skillId, mcpName, operation, error: error.message }, 'skill_mcp dispatch failed');
            return err(error);
          }
        },
      },
    ];
  }
}
