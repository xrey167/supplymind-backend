import { logger } from '../../config/logger';
import { notificationsRepo } from '../../modules/notifications/notifications.repo';
import { dispatchChannel } from '../../modules/notifications/notifications.service';
import type { Notification, NotificationChannel } from '../../modules/notifications/notifications.types';

const RETRY_BATCH_SIZE = 50;

interface RetryMetadata {
  _channels?: NotificationChannel[];
  _recipientEmail?: string | null;
}

/**
 * Hourly sweep: re-dispatches failed notifications whose outbound channels
 * (slack/telegram/email/websocket) should be retried. Returns the number of
 * notifications that had at least one outbound channel processed.
 */
export async function retryFailedNotifications(): Promise<number> {
  const failed = await notificationsRepo.listFailed(RETRY_BATCH_SIZE);
  let retried = 0;

  for (const n of failed) {
    const meta = (n.metadata ?? {}) as RetryMetadata;
    const channels = meta._channels ?? ['in_app'];
    const recipientEmail = meta._recipientEmail ?? undefined;
    const outbound = channels.filter((c) => c !== 'in_app');

    let succeeded = 0;
    for (const ch of outbound) {
      try {
        const sent = await dispatchChannel(ch, n as unknown as Notification, n.workspaceId, recipientEmail);
        if (sent) succeeded++;
      } catch (err) {
        logger.warn({ err, notificationId: n.id, ch }, 'Retry delivery failed');
      }
    }

    // markDelivered when there was nothing to retry (in_app only) or at least
    // one outbound channel succeeded; markFailed otherwise (all errored, all
    // skipped for missing creds, or a mix of the two).
    const shouldMarkDelivered = outbound.length === 0 || succeeded > 0;
    if (shouldMarkDelivered) {
      await notificationsRepo.markDelivered(n.id).catch((err) =>
        logger.warn({ err, notificationId: n.id }, 'markDelivered failed during retry'),
      );
    } else {
      await notificationsRepo.markFailed(n.id).catch((err) =>
        logger.warn({ err, notificationId: n.id }, 'markFailed failed during retry'),
      );
    }

    if (outbound.length > 0) retried++;
  }

  logger.info({ retried, found: failed.length }, 'Notification retry sweep complete');
  return retried;
}
