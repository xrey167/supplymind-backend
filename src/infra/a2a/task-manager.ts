import { nanoid } from 'nanoid';
import { AnthropicRawRuntime } from '../ai/anthropic';
import { OpenAIRawRuntime } from '../ai/openai';
import { GoogleRawRuntime } from '../ai/google';
import { AnthropicAgentSdkRuntime } from '../ai/anthropic-agent-sdk';
import { OpenAIAgentSdkRuntime } from '../ai/openai-agents';
import type { AgentRuntime, AIProvider, AgentMode } from '../ai/types';
import { skillRegistry } from '../../modules/skills/skills.registry';
import { dispatchSkill } from '../../modules/skills/skills.dispatch';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import type { Message, RunInput } from '../ai/types';
import type { DispatchContext } from '../../modules/skills/skills.types';
import type { A2ATask, TaskState, TaskSendParams } from './types';

const MAX_TOOL_CALL_ITERATIONS = 10;

interface TaskRecord {
  task: A2ATask;
  agentId: string;
  workspaceId: string;
}

class TaskManager {
  private tasks = new Map<string, TaskRecord>();

  async send(params: TaskSendParams & { agentConfig: { id: string; provider: AIProvider; mode: 'raw' | 'agent-sdk'; model: string; systemPrompt?: string; temperature?: number; maxTokens?: number; toolIds?: string[]; workspaceId: string }; callerId: string }): Promise<A2ATask> {
    const taskId = params.id ?? nanoid();
    const config = params.agentConfig;

    const task: A2ATask = {
      id: taskId,
      status: { state: 'submitted' },
      artifacts: [],
      history: [],
    };

    const record: TaskRecord = { task, agentId: config.id, workspaceId: config.workspaceId };
    this.tasks.set(taskId, record);

    eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'submitted', workspaceId: config.workspaceId });

    // Run async -- don't block the response
    this.executeTask(taskId, params, config).catch((error) => {
      this.updateStatus(taskId, 'failed', error.message);
    });

    return task;
  }

  private async executeTask(
    taskId: string,
    params: TaskSendParams,
    config: { id: string; provider: AIProvider; mode: 'raw' | 'agent-sdk'; model: string; systemPrompt?: string; temperature?: number; maxTokens?: number; toolIds?: string[]; workspaceId: string },
  ) {
    this.updateStatus(taskId, 'working');

    const runtime = this.resolveRuntime(config.provider, config.mode);

    // Get tools from skill registry, optionally filtered by agent's toolIds
    let tools = skillRegistry.toToolDefinitions();
    if (config.toolIds && config.toolIds.length > 0) {
      const allowed = new Set(config.toolIds);
      tools = tools.filter(t => allowed.has(t.name));
    }

    // Build initial messages
    const messages: Message[] = [];
    if (params.message) {
      const text = params.message.parts.filter(p => p.kind === 'text').map(p => (p as any).text).join('\n');
      messages.push({ role: 'user', content: text });
    }

    const dispatchCtx: DispatchContext = {
      callerId: config.id,
      workspaceId: config.workspaceId,
      callerRole: 'agent',
      traceId: taskId,
    };

    // Tool calling loop
    for (let i = 0; i < MAX_TOOL_CALL_ITERATIONS; i++) {
      const input: RunInput = {
        messages,
        systemPrompt: config.systemPrompt,
        tools,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      };

      const result = await runtime.run(input);
      if (!result.ok) {
        this.updateStatus(taskId, 'failed', result.error.message);
        return;
      }

      const runResult = result.value;

      // If there are tool calls, execute them
      if (runResult.stopReason === 'tool_use' && runResult.toolCalls?.length) {
        // Add assistant message with tool calls
        messages.push({ role: 'assistant', content: runResult.content || '' });

        for (const toolCall of runResult.toolCalls) {
          // Emit tool call start
          eventBus.publish(Topics.TASK_TOOL_CALL, {
            taskId, toolCall: { id: toolCall.id, name: toolCall.name, args: toolCall.args, status: 'in_progress' },
          });

          const toolResult = await dispatchSkill(toolCall.name, (toolCall.args ?? {}) as Record<string, unknown>, dispatchCtx);

          // Emit tool call result
          const resultValue = toolResult.ok ? toolResult.value : `Error: ${toolResult.error.message}`;
          eventBus.publish(Topics.TASK_TOOL_CALL, {
            taskId, toolCall: { id: toolCall.id, name: toolCall.name, args: toolCall.args, status: toolResult.ok ? 'completed' : 'failed', result: resultValue },
          });

          // Add tool result message
          messages.push({
            role: 'tool',
            content: typeof resultValue === 'string' ? resultValue : JSON.stringify(resultValue),
            toolCallId: toolCall.id,
          });
        }
        continue; // Loop again with tool results
      }

      // No tool calls -- we're done
      const record = this.tasks.get(taskId);
      if (record) {
        record.task.artifacts = [{ parts: [{ kind: 'text', text: runResult.content }] }];
        record.task.status = { state: 'completed' };
      }

      eventBus.publish(Topics.TASK_COMPLETED, { taskId, output: runResult.content });
      eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'completed', workspaceId: config.workspaceId });
      return;
    }

    // Max iterations reached
    this.updateStatus(taskId, 'failed', 'Max tool call iterations reached');
  }

  private updateStatus(taskId: string, state: TaskState, message?: string) {
    const record = this.tasks.get(taskId);
    if (record) {
      record.task.status = { state, message };
      eventBus.publish(Topics.TASK_STATUS, { taskId, status: state, workspaceId: record.workspaceId, message });
    }
  }

  private resolveRuntime(provider: AIProvider, mode: AgentMode): AgentRuntime {
    if (mode === 'agent-sdk') {
      if (provider === 'anthropic') return new AnthropicAgentSdkRuntime() as any;
      if (provider === 'openai') return new OpenAIAgentSdkRuntime() as any;
      throw new Error(`No agent-sdk runtime for provider: ${provider}`);
    }
    if (provider === 'anthropic') return new AnthropicRawRuntime();
    if (provider === 'openai') return new OpenAIRawRuntime();
    if (provider === 'google') return new GoogleRawRuntime();
    throw new Error(`No raw runtime for provider: ${provider}`);
  }

  get(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId)?.task;
  }

  cancel(taskId: string): A2ATask | undefined {
    const record = this.tasks.get(taskId);
    if (!record) return undefined;
    record.task.status = { state: 'canceled' };
    eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'canceled', workspaceId: record.workspaceId });
    return record.task;
  }

  list(workspaceId?: string): A2ATask[] {
    const tasks = Array.from(this.tasks.values());
    if (workspaceId) return tasks.filter(r => r.workspaceId === workspaceId).map(r => r.task);
    return tasks.map(r => r.task);
  }
}

export const taskManager = new TaskManager();
