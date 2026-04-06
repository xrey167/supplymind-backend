import type { Notification } from '../../notifications.types';
import { logger } from '../../../../config/logger';

/**
 * In-app channel: the DB record IS the notification.
 * This is a no-op dispatcher — the record already exists by the time this is called.
 */
export async function deliverInApp(_notification: Notification): Promise<void> {
  logger.debug({ notificationId: _notification.id }, 'In-app notification delivered (no-op)');
}
