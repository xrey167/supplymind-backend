import { eventBus } from '../bus';
import { Topics } from '../topics';
import { logger } from '../../config/logger';
import { notificationsService } from '../../modules/notifications/notifications.service';
import type { NotificationType } from '../../modules/notifications/notifications.types';

interface TaskEventData {
  taskId: string;
  workspaceId: string;
  error?: string;
}

interface BudgetEventData {
  workspaceId: string;
  currentSpend?: number;
  budgetLimit?: number;
}

interface MemberEventData {
  workspaceId: string;
  userId: string;
  memberName?: string;
}

export function initNotificationHandler() {
  eventBus.subscribe(Topics.TASK_ERROR, async (event) => {
    const data = event.data as TaskEventData;
    logger.debug({ taskId: data.taskId }, 'Creating notification for task error');
    await notificationsService.notify({
      workspaceId: data.workspaceId,
      type: 'task_error' as NotificationType,
      title: 'Task failed',
      body: `Task ${data.taskId} encountered an error: ${data.error ?? 'Unknown error'}`,
      metadata: { taskId: data.taskId },
    });
  }, { name: 'notification.handler.task_error' });

  eventBus.subscribe(Topics.BUDGET_WARNING, async (event) => {
    const data = event.data as BudgetEventData;
    logger.debug({ workspaceId: data.workspaceId }, 'Creating notification for budget warning');
    await notificationsService.notify({
      workspaceId: data.workspaceId,
      type: 'budget_warning' as NotificationType,
      title: 'Budget warning',
      body: `Workspace spending is approaching the budget limit.`,
      metadata: { currentSpend: data.currentSpend, budgetLimit: data.budgetLimit },
    });
  }, { name: 'notification.handler.budget_warning' });

  eventBus.subscribe(Topics.BUDGET_EXCEEDED, async (event) => {
    const data = event.data as BudgetEventData;
    logger.debug({ workspaceId: data.workspaceId }, 'Creating notification for budget exceeded');
    await notificationsService.notify({
      workspaceId: data.workspaceId,
      type: 'budget_exceeded' as NotificationType,
      title: 'Budget exceeded',
      body: `Workspace has exceeded its budget limit.`,
      metadata: { currentSpend: data.currentSpend, budgetLimit: data.budgetLimit },
    });
  }, { name: 'notification.handler.budget_exceeded' });

  eventBus.subscribe(Topics.MEMBER_JOINED, async (event) => {
    const data = event.data as MemberEventData;
    logger.debug({ workspaceId: data.workspaceId }, 'Creating notification for member joined');
    await notificationsService.notify({
      workspaceId: data.workspaceId,
      type: 'member_joined' as NotificationType,
      title: 'New member joined',
      body: `${data.memberName ?? 'A new member'} has joined the workspace.`,
      metadata: { userId: data.userId },
    });
  }, { name: 'notification.handler.member_joined' });

  logger.info('Notification event handler initialized');
}
