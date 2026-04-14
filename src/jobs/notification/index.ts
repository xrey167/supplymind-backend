import { logger } from '../../config/logger';
import { notificationsRepo } from '../../modules/notifications/notifications.repo';
import { dispatchChannel } from '../../modules/notifications/notifications.service';
import type { NotificationChannel } from '../../modules/notifications/notifications.types';

export async function retryFailedNotifications(): Promise<number> {
  const failed = await notificationsRepo.listFailed(50);
  let retried = 0;

  for (const n of failed) {
    const channels = ((n.metadata as Record<string, unknown>)?._channels ?? ['in_app']) as NotificationChannel[];
    const recipientEmail = ((n.metadata as Record<string, unknown>)?._recipientEmail ?? null) as string | null;
    const outbound = channels.filter((c) => c !== 'in_app');

    let attempted = 0;
    let succeeded = 0;

    for (const ch of outbound) {
      try {
        const sent = await dispatchChannel(ch, n as any, n.workspaceId, recipientEmail ?? undefined);
        if (sent) { attempted++; succeeded++; }
      } catch (err) {
        attempted++;
        logger.warn({ err, notificationId: n.id, ch }, 'Retry delivery failed');
      }
    }

    if (attempted === 0 || succeeded > 0) {
      await notificationsRepo.markDelivered(n.id).catch((err) =>
        logger.warn({ err, notificationId: n.id }, 'markDelivered failed during retry'),
      );
    } else {
      await notificationsRepo.markFailed(n.id).catch((err) =>
        logger.warn({ err, notificationId: n.id }, 'markFailed failed during retry'),
      );
    }
    retried++;
  }

  logger.info({ retried, found: failed.length }, 'Notification retry sweep complete');
  return retried;
}
