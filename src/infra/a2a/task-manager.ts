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
import { sessionsService } from '../../modules/sessions/sessions.service';
import { sessionsRepo } from '../../modules/sessions/sessions.repo';
import { taskRepo } from './task-repo';
import { logger } from '../../config/logger';
import { captureException } from '../observability/sentry';
import { workspaceSettingsService } from '../../modules/settings/workspace-settings/workspace-settings.service';

const MAX_TOOL_CALL_ITERATIONS = 10;

interface TaskRecord {
  task: A2ATask;
  agentId: string;
  workspaceId: string;
  controller: AbortController;
  totalTokens: { input: number; output: number };
}

const TASK_EVICTION_MS = 5 * 60 * 1000; // evict completed tasks after 5 minutes

class TaskManager {
  private tasks = new Map<string, TaskRecord>();

  /** Schedule eviction of a terminal task from the in-memory map */
  private scheduleEviction(taskId: string) {
    setTimeout(() => { this.tasks.delete(taskId); }, TASK_EVICTION_MS);
  }

  async send(params: TaskSendParams & { agentConfig: AgentConfig; callerId: string }): Promise<A2ATask> {
    const taskId = params.id ?? nanoid();
    const config = params.agentConfig;

    // Guard: when a pre-created taskId is supplied (e.g. BullMQ retry), check if the task
    // already reached a terminal state in DB and skip re-execution if so.
    if (params.id) {
      const existingTask = await taskRepo.findById(params.id).catch(() => null);
      if (existingTask) {
        const TERMINAL = new Set(['completed', 'failed', 'canceled']);
        if (TERMINAL.has(existingTask.status.state)) {
          logger.info({ taskId, state: existingTask.status.state }, 'Task already in terminal state — skipping re-execution');
          return existingTask;
        }
      }
    }

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
        sessionId: params.sessionId,
      });
    } catch (error: unknown) {
      logger.error({ taskId, error }, 'Failed to persist task to DB — aborting execution');
      this.updateStatus(taskId, 'failed', 'Failed to persist task');
      return task;
    }

    eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'submitted', workspaceId: config.workspaceId });

    // Check blockers — on timeout or error, leave as submitted (do not start)
    let blockers: string[] = [];
    try {
      const blockersPromise = taskRepo.getBlockers(taskId);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 500));
      const result = await Promise.race([blockersPromise, timeoutPromise]);
      if (result === null) {
        // DB too slow — stay submitted, do not execute
        logger.warn({ taskId }, 'Blocker check timed out — leaving task as submitted');
        return task;
      }
      blockers = result;
    } catch (err) {
      logger.warn({ taskId, err }, 'Blocker check failed — leaving task as submitted');
      return task;
    }

    if (blockers.length > 0) {
      logger.info({ taskId, blockers }, 'Task has active blockers, not starting');
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
      let userMessageContent = '';
      if (params.message) {
        userMessageContent = params.message.parts
          .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
          .map(p => p.text)
          .join('\n');
        messages.push({ role: 'user', content: userMessageContent });
      }

      // Persist initial user message to session — awaited so the boundary capture
      // in the first iteration sees this message rather than racing against it.
      let initialMessageId: string | undefined;
      if (params.sessionId && userMessageContent) {
        const initialMsg = await sessionsService.addMessage(params.sessionId, {
          role: 'user',
          content: userMessageContent,
        }).catch((err: unknown) => {
          logger.error({ err, taskId }, 'Failed to persist initial message to session');
          return null;
        });
        initialMessageId = initialMsg?.id;
      }

      const taggedHistory: TaggedMessage[] = [];

      // Fetch permission mode once per task to avoid a DB round-trip on every tool call.
      // If this throws, executeTask catches it and marks the task failed — fail-closed.
      const permissionMode = await workspaceSettingsService.getToolPermissionMode(config.workspaceId);

      const dispatchCtx: DispatchContext = {
        callerId: config.id,
        workspaceId: config.workspaceId,
        callerRole: 'agent' as const,
        traceId: taskId,
        signal,
        cachedPermissionMode: permissionMode,
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

        // Capture the most-recent session message ID before this turn so we
        // can use it as the compaction boundary if the context was compacted.
        // On the first iteration use the already-awaited initial message to avoid
        // an extra DB round-trip and eliminate any race with the persist above.
        let preTurnLastMessageId: string | undefined;
        if (params.sessionId) {
          if (i === 0) {
            preTurnLastMessageId = initialMessageId;
          } else {
            const latest = await sessionsRepo.getLatestMessage(params.sessionId).catch(() => null);
            preTurnLastMessageId = latest?.id;
          }
        }

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
        let streamUsage: { inputTokens: number; outputTokens: number } | undefined;
        let streamStopReason: RunResult['stopReason'] = 'end_turn';
        let streamError: string | null = null;

        for await (const event of runtime.stream(input)) {
          if (signal.aborted) break;
          switch (event.type) {
            case 'text_delta':
              accumulatedContent += event.data.text;
              eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId, delta: event.data.text });
              break;
            case 'thinking_delta':
              eventBus.publish(Topics.TASK_THINKING_DELTA, { taskId, thinking: event.data.thinking });
              break;
            case 'tool_call_end':
              streamToolCalls.push({ id: event.data.id, name: event.data.name, args: event.data.args });
              break;
            case 'done': {
              const { usage, stopReason: sr } = event.data;
              if (usage) streamUsage = usage;
              if (sr === 'tool_use' || sr === 'max_tokens' || sr === 'pause_turn') {
                streamStopReason = sr;
              } else if (sr) {
                streamStopReason = 'end_turn';
              }
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

        // Mark earlier session messages as compacted if context was compacted this turn
        if (context.wasCompacted && params.sessionId && preTurnLastMessageId) {
          sessionsRepo.markCompacted(params.sessionId, preTurnLastMessageId)
            .catch((err: unknown) => logger.error({ err, taskId }, 'Failed to mark session messages as compacted'));
        }

        // Persist assistant response to session (fire-and-forget)
        if (params.sessionId && runResult.content) {
          sessionsService.addMessage(params.sessionId, {
            role: 'assistant',
            content: runResult.content,
          }).catch((err: unknown) => logger.error({ err, taskId, roundId }, 'Failed to persist assistant message to session'));
        }

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
        this.scheduleEviction(taskId);
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
      if (state === 'completed' || state === 'failed' || state === 'canceled') {
        this.scheduleEviction(taskId);
        this.tryUnblockDependents(taskId).catch((error: unknown) => {
          logger.warn({ taskId, error }, 'Failed to check/unblock dependent tasks');
        });
      }
    }
  }

  /**
   * After a task reaches a terminal state, check if any tasks were blocked by it.
   * For each dependent that has no remaining active blockers, emit an unblock event
   * so the system can re-enqueue execution.
   */
  private async tryUnblockDependents(completedTaskId: string) {
    const deps = await taskRepo.getDependencies(completedTaskId);
    if (deps.blocks.length === 0) return;

    for (const dependentId of deps.blocks) {
      const remainingBlockers = await taskRepo.getBlockers(dependentId);
      if (remainingBlockers.length > 0) continue;

      logger.info({ taskId: dependentId, unblockedBy: completedTaskId }, 'All blockers resolved — task ready for execution');
      eventBus.publish(Topics.TASK_UNBLOCKED, { taskId: dependentId, unblockedBy: completedTaskId });
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
    this.scheduleEviction(taskId);
    return record.task;
  }

  /**
   * Interrupt the current turn without killing the task.
   * Aborts the current AbortController signal (stopping the active AI call),
   * then installs a fresh controller so the task can resume on the next input.
   * The task stays in 'working' state — it's paused, not canceled.
   */
  interrupt(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    const terminalStates = new Set(['canceled', 'completed', 'failed']);
    if (terminalStates.has(record.task.status.state)) return false;

    // Abort the current turn
    record.controller.abort(new AbortError('Turn interrupted by user', 'user'));
    // Install a fresh controller for the next turn
    record.controller = new AbortController();
    record.task.status = { state: 'input_required', message: 'Interrupted — waiting for input' };
    eventBus.publish(Topics.TASK_STATUS, { taskId, status: 'input_required', workspaceId: record.workspaceId });
    logger.info({ taskId }, 'Task interrupted — waiting for next input');
    return true;
  }

  list(workspaceId?: string): A2ATask[] {
    const tasks = Array.from(this.tasks.values());
    if (workspaceId) return tasks.filter(r => r.workspaceId === workspaceId).map(r => r.task);
    return tasks.map(r => r.task);
  }
}

export const taskManager = new TaskManager();
