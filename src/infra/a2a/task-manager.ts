import { nanoid } from 'nanoid';
import { createRuntime } from '../ai/runtime-factory';
import type { AgentRuntime, AIProvider, AgentMode } from '../ai/types';
import { skillRegistry } from '../../modules/skills/skills.registry';
import { dispatchSkill } from '../../modules/skills/skills.dispatch';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import type { Message, RunInput } from '../ai/types';
import type { DispatchContext } from '../../modules/skills/skills.types';
import type { A2ATask, TaskState, TaskSendParams } from './types';
import type { AgentConfig } from './coordinator-config';
import { AbortError } from '../../core/errors';
import { toolRegistry } from '../../modules/tools/tools.registry';

const MAX_TOOL_CALL_ITERATIONS = 10;

interface TaskRecord {
  task: A2ATask;
  agentId: string;
  workspaceId: string;
  controller: AbortController;
}

class TaskManager {
  private tasks = new Map<string, TaskRecord>();

  async send(params: TaskSendParams & { agentConfig: AgentConfig; callerId: string }): Promise<A2ATask> {
    const taskId = params.id ?? nanoid();
    const config = params.agentConfig;

    const task: A2ATask = {
      id: taskId,
      status: { state: 'submitted' },
      artifacts: [],
      history: [],
    };

    const controller = new AbortController();
    const record: TaskRecord = { task, agentId: config.id, workspaceId: config.workspaceId, controller };
    this.tasks.set(taskId, record);

    eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'submitted', workspaceId: config.workspaceId });

    // Run async -- don't block the response
    this.executeTask(taskId, params, config).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.updateStatus(taskId, 'failed', message);
      } catch {
        // Last-resort: updateStatus itself failed — nothing more we can do
      }
    });

    return task;
  }

  private async executeTask(
    taskId: string,
    params: TaskSendParams,
    config: AgentConfig,
  ) {
    const record = this.tasks.get(taskId);
    if (!record) return;
    const { signal } = record.controller;

    try {
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
        signal,
      };

      // Tool calling loop
      for (let i = 0; i < MAX_TOOL_CALL_ITERATIONS; i++) {
        if (signal.aborted) {
          if (record.task.status.state !== 'canceled') {
            this.updateStatus(taskId, 'canceled', 'Aborted before iteration');
          }
          return;
        }

        const input: RunInput = {
          messages,
          systemPrompt: config.systemPrompt,
          tools,
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          toolChoice: config.toolChoice,
          disableParallelToolUse: config.disableParallelToolUse,
          signal,
        };

        const result = await runtime.run(input);
        if (!result.ok) {
          this.updateStatus(taskId, 'failed', result.error.message);
          return;
        }

        if (signal.aborted) {
          if (record.task.status.state !== 'canceled') {
            this.updateStatus(taskId, 'canceled', 'Aborted after model response');
          }
          return;
        }

        const runResult = result.value;

        // If there are tool calls, execute them
        if (runResult.stopReason === 'tool_use' && runResult.toolCalls?.length) {
          // Add assistant message with tool calls
          messages.push({ role: 'assistant', content: runResult.content || '' });

          const batches = this.partitionToolCalls(runResult.toolCalls);

          for (const batch of batches) {
            if (signal.aborted) {
              if (record.task.status.state !== 'canceled') {
                this.updateStatus(taskId, 'canceled', 'Aborted during tool batching');
              }
              return;
            }

            if (batch.parallel) {
              // Read-only tools: run concurrently
              const results = await Promise.allSettled(
                batch.calls.map(tc => this.executeToolCall(tc, taskId, dispatchCtx))
              );
              for (let idx = 0; idx < results.length; idx++) {
                const r = results[idx];
                if (r.status === 'fulfilled') {
                  messages.push(r.value);
                } else {
                  // Tool threw — push an error message so the model knows
                  messages.push({
                    role: 'tool',
                    content: `Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
                    toolCallId: batch.calls[idx].id,
                  });
                }
              }
            } else {
              // Write/unknown tools: serial
              for (const tc of batch.calls) {
                if (signal.aborted) {
                  if (record.task.status.state !== 'canceled') {
                    this.updateStatus(taskId, 'canceled', 'Aborted during serial tool execution');
                  }
                  return;
                }
                const msg = await this.executeToolCall(tc, taskId, dispatchCtx);
                messages.push(msg);
              }
            }
          }
          continue; // Loop again with tool results
        }

        // pause_turn — server tool paused, continue the loop
        if (runResult.stopReason === 'pause_turn') {
          messages.push({ role: 'assistant', content: runResult.content || '' });
          continue;
        }

        // No tool calls -- we're done
        const currentRecord = this.tasks.get(taskId);
        if (currentRecord) {
          currentRecord.task.artifacts = [{ parts: [{ kind: 'text', text: runResult.content }] }];
          currentRecord.task.status = { state: 'completed' };
        }

        eventBus.publish(Topics.TASK_COMPLETED, { taskId, output: runResult.content });
        eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'completed', workspaceId: config.workspaceId });
        return;
      }

      // Max iterations reached
      this.updateStatus(taskId, 'failed', 'Max tool call iterations reached');
    } finally {
      // Schedule cleanup after callers have had time to read final state
      setTimeout(() => this.tasks.delete(taskId), 5_000);
    }
  }

  private partitionToolCalls(
    calls: Array<{ id: string; name: string; args: unknown }>,
  ): Array<{ parallel: boolean; calls: Array<{ id: string; name: string; args: unknown }> }> {
    const batches: Array<{ parallel: boolean; calls: Array<{ id: string; name: string; args: unknown }> }> = [];
    let current: Array<{ id: string; name: string; args: unknown }> = [];
    let currentIsReadOnly: boolean | null = null;

    for (const call of calls) {
      const tool = toolRegistry.get(call.name);
      const readOnly = tool?.isReadOnly ?? false;

      if (currentIsReadOnly === null) {
        currentIsReadOnly = readOnly;
        current.push(call);
      } else if (readOnly === currentIsReadOnly) {
        current.push(call);
      } else {
        batches.push({ parallel: currentIsReadOnly, calls: current });
        current = [call];
        currentIsReadOnly = readOnly;
      }
    }
    if (current.length > 0) {
      batches.push({ parallel: currentIsReadOnly!, calls: current });
    }
    return batches;
  }

  private async executeToolCall(
    toolCall: { id: string; name: string; args: unknown },
    taskId: string,
    dispatchCtx: DispatchContext,
  ): Promise<Message> {
    eventBus.publish(Topics.TASK_TOOL_CALL, {
      taskId,
      toolCall: { id: toolCall.id, name: toolCall.name, args: toolCall.args, status: 'in_progress' },
    });

    const toolResult = await dispatchSkill(
      toolCall.name,
      (toolCall.args ?? {}) as Record<string, unknown>,
      dispatchCtx,
    );

    const resultValue = toolResult.ok ? toolResult.value : `Error: ${toolResult.error.message}`;

    eventBus.publish(Topics.TASK_TOOL_CALL, {
      taskId,
      toolCall: { id: toolCall.id, name: toolCall.name, args: toolCall.args, status: toolResult.ok ? 'completed' : 'failed', result: resultValue },
    });

    return {
      role: 'tool',
      content: typeof resultValue === 'string' ? resultValue : JSON.stringify(resultValue),
      toolCallId: toolCall.id,
    };
  }

  private updateStatus(taskId: string, state: TaskState, message?: string) {
    const record = this.tasks.get(taskId);
    if (record) {
      record.task.status = { state, message };
      eventBus.publish(Topics.TASK_STATUS, { taskId, status: state, workspaceId: record.workspaceId, message });
    }
  }

  private resolveRuntime(provider: AIProvider, mode: AgentMode): AgentRuntime {
    return createRuntime(provider, mode);
  }

  get(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId)?.task;
  }

  cancel(taskId: string): A2ATask | undefined {
    const record = this.tasks.get(taskId);
    if (!record) return undefined;
    if (record.task.status.state === 'canceled') {
      return record.task; // already canceled, no-op
    }
    record.controller.abort(new AbortError('Task canceled by user', 'user'));
    record.task.status = { state: 'canceled' };
    eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'canceled', workspaceId: record.workspaceId });
    eventBus.publish(Topics.TASK_CANCELED, { taskId, workspaceId: record.workspaceId });
    return record.task;
  }

  list(workspaceId?: string): A2ATask[] {
    const tasks = Array.from(this.tasks.values());
    if (workspaceId) return tasks.filter(r => r.workspaceId === workspaceId).map(r => r.task);
    return tasks.map(r => r.task);
  }
}

export const taskManager = new TaskManager();
