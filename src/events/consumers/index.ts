import { eventBus } from '../bus';
import { Topics } from '../topics';
import { logger } from '../../config/logger';
import { taskRepo } from '../../infra/a2a/task-repo';
import { enqueueAgentRun } from '../../infra/queue/bullmq';
import { initMemoryExtractionHandler } from './memory-extraction.handler';
import { initNotificationHandler } from './notification.handler';
import { initAuditLogHandler } from './audit-log.handler';
import { initDomainExtractionHandler } from '../../modules/domain-knowledge/domain-extractor';
import { initSkillObserver } from '../../modules/learning/observers/skill-observer';
import { initMemoryObserver } from '../../modules/learning/observers/memory-observer';
import { initTaskObserver } from '../../modules/learning/observers/task-observer';

export function initEventConsumers() {
  initMemoryExtractionHandler();
  initDomainExtractionHandler();
  initSkillObserver();
  initMemoryObserver();
  initTaskObserver();
  initNotificationHandler();
  initAuditLogHandler();
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

  // Re-enqueue tasks whose blockers have all completed
  eventBus.subscribe(Topics.TASK_UNBLOCKED, async (event) => {
    const { taskId, unblockedBy } = event.data as { taskId: string; unblockedBy: string };
    logger.info({ taskId, unblockedBy }, 'Task unblocked — re-enqueueing');
    try {
      const taskRow = await taskRepo.findRawById(taskId);
      if (!taskRow) {
        logger.warn({ taskId }, 'Unblocked task not found in DB');
        return;
      }
      await enqueueAgentRun({
        taskId: taskRow.id,
        agentId: taskRow.agentId,
        workspaceId: taskRow.workspaceId,
        callerId: 'system:unblock',
        message: taskRow.input as any,
      });
    } catch (error) {
      logger.error({ taskId, error }, 'Failed to re-enqueue unblocked task');
    }
  });
}
