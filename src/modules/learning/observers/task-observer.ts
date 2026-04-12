/**
 * Task Observer
 *
 * Subscribes to TASK_COMPLETED and TASK_ERROR to capture task-level
 * success/failure signals for the learning engine.
 */

import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';
import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { logger } from '../../../config/logger';

let registered = false;

export function _resetTaskObserver() {
  registered = false;
}

export function initTaskObserver(bus = eventBus, dbClient = db) {
  if (registered) return;
  registered = true;

  bus.subscribe(Topics.TASK_COMPLETED, async (event) => {
    const data = event.data as { taskId: string; workspaceId?: string; agentId?: string; durationMs?: number };
    if (!data.workspaceId) return;
    try {
      await dbClient.insert(learningObservations).values({
        workspaceId: data.workspaceId,
        observationType: 'task_completed',
        signalStrength: 0.5,
        payload: { taskId: data.taskId, agentId: data.agentId, durationMs: data.durationMs },
        sourceTopic: Topics.TASK_COMPLETED,
      });
    } catch (err) {
      logger.warn({ taskId: data.taskId, error: err }, 'Task observer (completed) failed');
    }
  });

  bus.subscribe(Topics.TASK_ERROR, async (event) => {
    const data = event.data as { taskId: string; workspaceId?: string; error?: string };
    if (!data.workspaceId) return;
    try {
      await dbClient.insert(learningObservations).values({
        workspaceId: data.workspaceId,
        observationType: 'task_error',
        signalStrength: 1.0,
        payload: { taskId: data.taskId, error: data.error },
        sourceTopic: Topics.TASK_ERROR,
      });
    } catch (err) {
      logger.warn({ taskId: data.taskId, error: err }, 'Task observer (error) failed');
    }
  });
}
