import { eventBus } from '../bus';
import { Topics } from '../topics';
import { logger } from '../../config/logger';

export function initEventConsumers() {
  eventBus.on(Topics.SKILL_INVOKED, (data: any) => {
    logger.info({ skill: data.name, durationMs: data.durationMs, success: data.success }, 'Skill invoked');
  });

  eventBus.on(Topics.TASK_COMPLETED, (data: any) => {
    logger.info({ taskId: data.taskId }, 'Task completed');
  });

  eventBus.on(Topics.TASK_ERROR, (data: any) => {
    logger.error({ taskId: data.taskId, error: data.error }, 'Task error');
  });
}
