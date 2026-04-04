import { logger } from '../../config/logger';
import { eventBus } from '../bus';
import { taskManager } from '../../infra/a2a/task-manager';
import { workerRegistry } from '../../infra/a2a/worker-registry';
import type { BusEvent } from '../bus';

export function initWsConsumers(): void {
  // Subscribe to ws.task.send — creates a task
  eventBus.subscribe('ws.task.send', handleWsTaskSend, { name: 'ws:task:send' });

  // Subscribe to ws.task.cancel — cancels a task
  eventBus.subscribe('ws.task.cancel', handleWsTaskCancel, { name: 'ws:task:cancel' });

  // Subscribe to ws.task.input — input_required stub (not yet implemented)
  eventBus.subscribe('ws.task.input', handleWsTaskInput, { name: 'ws:task:input' });

  // Subscribe to ws.a2a.send — delegates to external agent
  eventBus.subscribe('ws.a2a.send', handleWsA2aSend, { name: 'ws:a2a:send' });
}

async function handleWsTaskSend(event: BusEvent): Promise<void> {
  const data = event.data as any;

  try {
    const { clientId, agentId, messages } = data;

    if (!agentId) {
      logger.warn({ clientId }, 'ws.task.send missing agentId');
      await eventBus.publish('task.error', {
        clientId,
        error: 'Missing agentId in task send request',
      });
      return;
    }

    // Create a minimal default agent config
    // TODO: extract workspaceId from WS auth context
    const agentConfig = {
      id: agentId,
      provider: 'anthropic' as const,
      mode: 'raw' as const,
      model: 'claude-sonnet-4-20250514',
      workspaceId: 'default',
      toolIds: [],
    };

    const task = await taskManager.send({
      message: messages ? { role: 'user', parts: messages } : undefined,
      agentConfig,
      callerId: clientId,
    });

    logger.info({ taskId: task.id, clientId, agentId }, 'Task created from WebSocket');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ clientId: data.clientId, error: err.message }, 'Failed to create task from WebSocket');
    await eventBus.publish('task.error', {
      clientId: data.clientId,
      error: err.message,
    });
  }
}

async function handleWsTaskCancel(event: BusEvent): Promise<void> {
  const data = event.data as any;

  try {
    const { clientId, taskId } = data;

    if (!taskId) {
      logger.warn({ clientId }, 'ws.task.cancel missing taskId');
      return;
    }

    const result = taskManager.cancel(taskId);

    if (result) {
      logger.info({ taskId, clientId, status: result.status.state }, 'Task canceled from WebSocket');
    } else {
      logger.warn({ taskId, clientId }, 'Task not found for cancellation');
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ clientId: data.clientId, taskId: data.taskId, error: err.message }, 'Failed to cancel task');
  }
}

async function handleWsTaskInput(event: BusEvent): Promise<void> {
  const data = event.data as any;
  const { clientId, taskId, input } = data;

  logger.warn(
    { clientId, taskId, input },
    'ws.task.input not yet implemented (input_required not yet implemented)',
  );
  // TODO: Implement input_required workflow once task manager supports resumption
}

async function handleWsA2aSend(event: BusEvent): Promise<void> {
  const data = event.data as any;

  try {
    const { clientId, agentUrl, skillId, args } = data;

    if (!agentUrl) {
      logger.warn({ clientId }, 'ws.a2a.send missing agentUrl');
      await eventBus.publish('task.error', {
        clientId,
        error: 'Missing agentUrl in A2A send request',
      });
      return;
    }

    const result = await workerRegistry.delegate(agentUrl, {
      skillId,
      args,
    });

    logger.info({ clientId, agentUrl, skillId, resultType: typeof result }, 'A2A delegation succeeded');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { clientId: data.clientId, agentUrl: data.agentUrl, error: err.message },
      'Failed to delegate A2A request',
    );
    await eventBus.publish('task.error', {
      clientId: data.clientId,
      error: err.message,
    });
  }
}
