import { nanoid } from 'nanoid';
import * as runtimeFactory from '../ai/runtime-factory';
import type { AgentRuntime, AIProvider, AgentMode } from '../ai/types';
import * as skillsRegistryModule from '../../modules/skills/skills.registry';
import * as skillsDispatch from '../../modules/skills/skills.dispatch';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import type { Message, RunInput, RunResult } from '../ai/types';
import type { DispatchContext } from '../../modules/skills/skills.types';
import type { A2ATask, TaskState, TaskSendParams, A2AMessage } from './types';
import type { AgentConfig } from './coordinator-config';
import { AbortError } from '../../core/errors';
import { toolRegistry } from '../../modules/tools/tools.registry';
import { contextService } from '../../modules/context/context.service';
import { taskRepo } from './task-repo';
import { logger } from '../../config/logger';
import { captureException } from '../observability/sentry';

const MAX_TOOL_CALL_ITERATIONS = 10;

interface TaskRecord {
  task: A2ATask;
  agentId: string;
  workspaceId: string;
  controller: AbortController;
  totalTokens: { input: number; output: number };
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
    const record: TaskRecord = { task, agentId: config.id, workspaceId: config.workspaceId, controller, totalTokens: { input: 0, output: 0 } };
    this.tasks.set(taskId, record);

    // Persist to DB — awaited so the row exists before getBlockers queries it
    try {
      await taskRepo.create({
        id: taskId,
        workspaceId: config.workspaceId,
        agentId: config.id,
        status: 'submitted',
        input: params.message ?? {},
      });
    } catch (error: unknown) {
      logger.error({ taskId, error }, 'Failed to persist task to DB');
    }

    eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'submitted', workspaceId: config.workspaceId });

    // Check blockers before running — if blocked, stay submitted and skip executeTask.
    // Use a short timeout so a slow/unavailable DB doesn't delay task start.
    const blockersTimeout = new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 500));
    const blockers = await Promise.race([
      taskRepo.getBlockers(taskId).catch(() => [] as string[]),
      blockersTimeout,
    ]);
    if (blockers.length > 0) {
      task.status = { state: 'submitted', message: `Blocked by tasks: ${blockers.join(', ')}` };
      taskRepo.updateStatus(taskId, 'submitted').catch((error: unknown) => {
        logger.error({ taskId, error }, 'Failed to update blocked task status in DB');
      });
      return task;
    }

    // Run async -- don't block the response
    this.executeTask(taskId, params, config).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ taskId, error }, 'executeTask threw unexpectedly');
      captureException(error, { taskId, workspaceId: config.workspaceId });
      try {
        this.updateStatus(taskId, 'failed', message);
      } catch (updateError) {
        logger.error({ taskId, error: updateError }, 'updateStatus failed in executeTask error handler');
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
    if (!record) {
      logger.error({ taskId }, 'executeTask: task record not found — task may be stuck as submitted in DB');
      return;
    }
    const { signal } = record.controller;

    try {
      this.updateStatus(taskId, 'working');

      const runtime = this.resolveRuntime(config.provider, config.mode);

      // Get tools from skill registry, filtered by agent's toolIds
      // When toolIds is defined (even if empty), only those tools are allowed
      // When toolIds is undefined/null, all tools are available
      let tools = skillsRegistryModule.skillRegistry.toToolDefinitions();
      if (config.toolIds) {
        const allowed = new Set(config.toolIds);
        tools = tools.filter(t => allowed.has(t.name));
      }

      interface TaggedMessage {
        message: Message;
        roundId: string;
        iterationIndex: number;
      }

      // Build initial messages
      const messages: Message[] = [];
      if (params.message) {
        const text = params.message.parts.filter(p => p.kind === 'text').map(p => (p as any).text).join('\n');
        messages.push({ role: 'user', content: text });
      }

      const taggedHistory: TaggedMessage[] = [];

      const dispatchCtx: DispatchContext = {
        callerId: config.id,
        workspaceId: config.workspaceId,
        callerRole: 'agent' as const,
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

        const roundId = nanoid(8);
        const pushMsg = (msg: Message) => {
          messages.push(msg);
          taggedHistory.push({ message: msg, roundId, iterationIndex: i });
        };

        // Prepare context: inject memories, snip old tool results, compact if needed
        const context = await contextService.prepare({
          messages,
          agentConfig: {
            model: config.model,
            systemPrompt: config.systemPrompt,
            workspaceId: config.workspaceId,
            agentId: config.id,
          },
        });

        if (signal.aborted) {
          if (record.task.status.state !== 'canceled') {
            this.updateStatus(taskId, 'canceled', 'Aborted after context preparation');
          }
          return;
        }

        const input: RunInput = {
          messages: context.messages,
          systemPrompt: context.systemPrompt,
          tools,
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          toolChoice: config.toolChoice,
          disableParallelToolUse: config.disableParallelToolUse,
          signal,
        };

        let accumulatedContent = '';
        const streamToolCalls: Array<{ id: string; name: string; args: unknown }> = [];
        let streamUsage = { inputTokens: 0, outputTokens: 0 };
        let streamStopReason: RunResult['stopReason'] = 'end_turn';
        let streamError: string | null = null;

        for await (const event of runtime.stream(input)) {
          if (signal.aborted) break;
          switch (event.type) {
            case 'text_delta':
              accumulatedContent += event.data.text;
              eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId, delta: event.data.text });
              break;
            case 'tool_call_end':
              streamToolCalls.push({ id: event.data.id, name: event.data.name, args: event.data.args });
              break;
            case 'done': {
              const doneData = event.data as { usage?: { inputTokens: number; outputTokens: number }; stopReason?: RunResult['stopReason'] };
              if (doneData.usage) streamUsage = doneData.usage;
              if (doneData.stopReason) streamStopReason = doneData.stopReason;
              break;
            }
            case 'error':
              streamError = event.data.error;
              break;
          }
        }

        if (streamError) {
          this.updateStatus(taskId, 'failed', streamError);
          return;
        }

        if (signal.aborted) {
          if (record.task.status.state !== 'canceled') {
            this.updateStatus(taskId, 'canceled', 'Aborted after model response');
          }
          return;
        }

        const runResult: RunResult = {
          content: accumulatedContent,
          toolCalls: streamToolCalls.length > 0 ? streamToolCalls : undefined,
          usage: streamUsage,
          stopReason: streamStopReason,
        };

        const usage = runResult.usage ?? { inputTokens: 0, outputTokens: 0 };
        record.totalTokens.input += usage.inputTokens;
        record.totalTokens.output += usage.outputTokens;

        // If there are tool calls, execute them
        if (runResult.stopReason === 'tool_use' && runResult.toolCalls?.length) {
          // Add assistant message with tool calls
          pushMsg({ role: 'assistant', content: runResult.content || '' });

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
                  pushMsg(r.value);
                } else {
                  // Tool threw — push an error message so the model knows
                  pushMsg({
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
                pushMsg(msg);
              }
            }
          }
          eventBus.publish(Topics.TASK_ROUND_COMPLETED, {
            taskId,
            roundId,
            iterationIndex: i,
            toolCallCount: runResult.toolCalls?.length ?? 0,
            tokenUsage: { input: usage.inputTokens, output: usage.outputTokens },
            totalTokens: { input: record.totalTokens.input, output: record.totalTokens.output },
          });
          continue; // Loop again with tool results
        }

        // pause_turn — server tool paused, continue the loop
        if (runResult.stopReason === 'pause_turn') {
          pushMsg({ role: 'assistant', content: runResult.content || '' });
          eventBus.publish(Topics.TASK_ROUND_COMPLETED, {
            taskId,
            roundId,
            iterationIndex: i,
            toolCallCount: 0,
            tokenUsage: { input: usage.inputTokens, output: usage.outputTokens },
            totalTokens: { input: record.totalTokens.input, output: record.totalTokens.output },
          });
          continue;
        }

        // No tool calls -- we're done
        // Tag the final assistant message so it appears in history with its own roundId
        pushMsg({ role: 'assistant', content: runResult.content || '' });

        const currentRecord = this.tasks.get(taskId);
        if (currentRecord) {
          currentRecord.task.artifacts = [{ parts: [{ kind: 'text', text: runResult.content }] }];
          currentRecord.task.history = taggedHistory.map(t => ({
            role: (t.message.role === 'assistant' ? 'agent' : 'user') as A2AMessage['role'],
            parts: [{ kind: 'text' as const, text: typeof t.message.content === 'string' ? t.message.content : JSON.stringify(t.message.content) }],
            roundId: t.roundId,
          }));
          currentRecord.task.status = { state: 'completed' };
          currentRecord.task.metadata = {
            ...currentRecord.task.metadata,
            totalTokens: currentRecord.totalTokens,
          };
        }

        taskRepo.updateStatus(taskId, 'completed', runResult.content, currentRecord?.task.artifacts).catch((error: unknown) => {
          logger.error({ taskId, error }, 'Failed to update task status to completed in DB');
        });
        eventBus.publish(Topics.TASK_COMPLETED, { taskId, output: runResult.content });
        eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'completed', workspaceId: config.workspaceId });
        return;
      }

      // Max iterations reached
      this.updateStatus(taskId, 'failed', 'Max tool call iterations reached');
    } finally {
      // No cleanup — in-memory record persists until server restart.
      // DB is the source of truth for historical tasks.
      // AbortController remains accessible for the task's lifetime in this process.
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

    const toolCallStart = Date.now();
    const toolResult = await skillsDispatch.dispatchSkill(
      toolCall.name,
      (toolCall.args ?? {}) as Record<string, unknown>,
      dispatchCtx,
    );

    const resultValue = toolResult.ok ? toolResult.value : `Error: ${toolResult.error.message}`;

    taskRepo.logToolCall({
      taskId,
      skillName: toolCall.name,
      status: toolResult.ok ? 'completed' : 'failed',
      input: toolCall.args ?? {},
      output: resultValue,
      durationMs: Date.now() - toolCallStart,
      error: toolResult.ok ? undefined : String(resultValue),
    }).catch((error: unknown) => {
      logger.error({ taskId, toolName: toolCall.name, error }, 'Failed to log tool call to DB');
    });

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
      taskRepo.updateStatus(taskId, state, undefined, undefined).catch((error: unknown) => {
        logger.error({ taskId, state, error }, 'Failed to update task status in DB');
        captureException(error, { taskId, state });
      });
    }
  }

  private resolveRuntime(provider: AIProvider, mode: AgentMode): AgentRuntime {
    return runtimeFactory.createRuntime(provider, mode);
  }

  get(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId)?.task;
  }

  cancel(taskId: string): A2ATask | undefined {
    const record = this.tasks.get(taskId);
    if (!record) return undefined;
    const terminalStates = new Set(['canceled', 'completed', 'failed']);
    if (terminalStates.has(record.task.status.state)) {
      return record.task; // already in terminal state, no-op
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
