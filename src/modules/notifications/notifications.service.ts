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
  QuietHours,
} from './notifications.types';

export async function dispatchChannel(
  ch: NotificationChannel,
  notification: Notification,
  workspaceId: string,
  recipientEmail?: string | null,
): Promise<boolean> {
  switch (ch) {
    case 'email':
      if (recipientEmail) {
        const { deliverEmail } = await import('./channels/email/email.channel');
        await deliverEmail(notification, recipientEmail);
        return true;   // delivered
      }
      return false;  // no address — skip

    case 'slack': {
      const { credentialsService } = await import('../credentials/credentials.service');
      const cred = await credentialsService.getByProvider(workspaceId, 'slack').catch(() => null);
      if (!cred) return false;   // no credentials — skip
      const { deliverSlack } = await import('./channels/slack/slack.channel');
      await deliverSlack(notification, cred.value);
      return true;
    }

    case 'telegram': {
      const { credentialsService } = await import('../credentials/credentials.service');
      const cred = await credentialsService.getByProvider(workspaceId, 'telegram').catch(() => null);
      const chatId = String(cred?.metadata?.chatId ?? '');
      if (!cred || !chatId) return false;   // no credentials or chatId — skip
      const { deliverTelegram } = await import('./channels/telegram/telegram.channel');
      await deliverTelegram(notification, cred.value, chatId);
      return true;
    }

    case 'websocket':
      await deliverWebSocket(notification);
      return true;

    case 'in_app':
    default:
      return false;  // in_app is the DB record itself; default is intentional no-op
  }
}

export function isInQuietHours(qh: QuietHours): boolean {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: qh.tz,
    });
    const current = fmt.format(now); // "HH:MM"
    const [startH, startM] = qh.start.split(':').map(Number);
    const [endH, endM] = qh.end.split(':').map(Number);
    const [curH, curM] = current.split(':').map(Number);
    const toMins = (h: number, m: number) => h * 60 + m;
    const cur = toMins(curH!, curM!);
    const start = toMins(startH!, startM!);
    const end = toMins(endH!, endM!);
    // Handle overnight window (e.g. 22:00–08:00)
    if (start > end) return cur >= start || cur < end;
    return cur >= start && cur < end;
  } catch {
    // Invalid timezone or malformed times — fail open (do not suppress delivery)
    return false;
  }
}

export class NotificationsService {
  /**
   * Core dispatch: check preferences, insert DB record, dispatch to channels, publish event.
   */
  async notify(input: CreateNotificationInput): Promise<Notification | null> {
    // 1. Resolve channels + quiet hours from preferences
    let channels: NotificationChannel[] = ['in_app'];
    let quietHours: QuietHours | null = null;

    if (input.userId) {
      const pref = await notificationPreferencesRepo.get(
        input.userId,
        input.workspaceId,
        input.type,
      );
      const global = await notificationPreferencesRepo.getGlobal(
        input.userId,
        input.workspaceId,
      );
      if (pref?.muted || global?.muted) {
        logger.debug({ userId: input.userId, type: input.type }, 'Notification muted by preference');
        return null;
      }
      if (pref?.channels) {
        channels = pref.channels as NotificationChannel[];
      }
      quietHours = (pref?.quietHours ?? global?.quietHours ?? null) as QuietHours | null;
    }

    // 2. Insert DB record (always in_app), storing resolved channels in metadata
    const record = await notificationsRepo.create({
      ...input,
      metadata: {
        ...input.metadata ?? {},
        _channels: channels,
        _recipientEmail: input.recipientEmail ?? null,
      },
    }, 'in_app');
    const notification = record as unknown as Notification;

    // 3. Dispatch to channels
    await deliverInApp(notification);

    const skipOutbound = quietHours != null && isInQuietHours(quietHours);

    const outbound = channels.filter((c) => c !== 'in_app');
    let attempted = 0;
    let succeeded = 0;

    if (!skipOutbound) {
      for (const ch of outbound) {
        try {
          const sent = await dispatchChannel(ch, notification, input.workspaceId, input.recipientEmail);
          if (sent) {
            attempted++;
            succeeded++;
          }
          // sent=false means intentionally skipped — don't count as attempt or failure
        } catch (err) {
          attempted++;
          logger.warn({ err, notificationId: notification.id, ch }, `${ch} delivery failed`);
        }
      }
    }

    // markDelivered if: no outbound channels, or all were skipped (none attempted), or at least one succeeded, or quiet hours
    // markFailed if: at least one delivery was attempted AND all attempts failed
    if (attempted === 0 || succeeded > 0 || skipOutbound) {
      await notificationsRepo.markDelivered(notification.id).catch((err) =>
        logger.warn({ err, notificationId: notification.id }, 'markDelivered failed'),
      );
    } else {
      await notificationsRepo.markFailed(notification.id).catch((err) =>
        logger.warn({ err, notificationId: notification.id }, 'markFailed failed'),
      );
    }

    // 4. Publish NOTIFICATION_CREATED event
    await eventBus.publish(Topics.NOTIFICATION_CREATED, {
      notificationId: notification.id,
      workspaceId: notification.workspaceId,
      userId: notification.userId,
      type: notification.type,
    }, { source: 'notifications.service' });

    logger.info(
      { notificationId: notification.id, type: notification.type, channels, skipOutbound },
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
