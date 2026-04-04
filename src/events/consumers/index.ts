import { eventBus } from '../bus';
import { Topics } from '../topics';
import { logger } from '../../config/logger';
import { initWsConsumers } from './ws-consumers';

export function initEventConsumers() {
  // Initialize system event logging consumers
  eventBus.subscribe(Topics.SKILL_INVOKED, (event) => {
    const data = event.data as any;
    logger.info({ skill: data.name, durationMs: data.durationMs, success: data.success }, 'Skill invoked');
  });

  eventBus.subscribe(Topics.TASK_COMPLETED, (event) => {
    const data = event.data as any;
    logger.info({ taskId: data.taskId }, 'Task completed');
  });

  eventBus.subscribe(Topics.TASK_ERROR, (event) => {
    const data = event.data as any;
    logger.error({ taskId: data.taskId, error: data.error }, 'Task error');
  });

  // Initialize WebSocket event consumers (handle incoming WS messages)
  initWsConsumers();
}

export { initWsConsumers };
