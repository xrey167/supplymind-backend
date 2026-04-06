import { logger } from '../../config/logger';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { notificationsRepo } from './notifications.repo';
import { notificationPreferencesRepo } from './preferences/notification-preferences.repo';
import { deliverInApp } from './channels/in-app/in-app.channel';
import { deliverWebSocket } from './channels/websocket/websocket.channel';
import type {
  CreateNotificationInput,
  Notification,
  NotificationChannel,
  NotificationFilter,
} from './notifications.types';

export class NotificationsService {
  /**
   * Core dispatch: check preferences, insert DB record, dispatch to channels, publish event.
   */
  async notify(input: CreateNotificationInput): Promise<Notification | null> {
    // 1. Check user preferences
    let channels: NotificationChannel[] = ['in_app'];
    if (input.userId) {
      const pref = await notificationPreferencesRepo.get(
        input.userId,
        input.workspaceId,
        input.type,
      );
      if (pref?.muted) {
        logger.debug({ userId: input.userId, type: input.type }, 'Notification muted by preference');
        return null;
      }
      if (pref?.channels) {
        channels = pref.channels as NotificationChannel[];
      }
    }

    // 2. Insert DB record (always in_app)
    const record = await notificationsRepo.create(input, 'in_app');
    const notification = record as unknown as Notification;

    // 3. Dispatch to channels
    await deliverInApp(notification);

    if (channels.includes('websocket')) {
      await deliverWebSocket(notification);
    }

    // 4. Publish NOTIFICATION_CREATED event
    await eventBus.publish(Topics.NOTIFICATION_CREATED, {
      notificationId: notification.id,
      workspaceId: notification.workspaceId,
      userId: notification.userId,
      type: notification.type,
    }, { source: 'notifications.service' });

    logger.info(
      { notificationId: notification.id, type: notification.type, channels },
      'Notification dispatched',
    );

    return notification;
  }

  async list(userId: string, workspaceId: string, filter?: NotificationFilter) {
    return notificationsRepo.list(userId, workspaceId, filter);
  }

  async markRead(id: string) {
    return notificationsRepo.markRead(id);
  }

  async markAllRead(userId: string, workspaceId: string) {
    return notificationsRepo.markAllRead(userId, workspaceId);
  }

  async getUnreadCount(userId: string, workspaceId: string) {
    return notificationsRepo.getUnreadCount(userId, workspaceId);
  }
}

export const notificationsService = new NotificationsService();
