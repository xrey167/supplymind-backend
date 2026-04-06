import { logger } from '../../config/logger';

/**
 * Placeholder job for retrying failed notifications.
 * Will scan for notifications with status='failed' and re-attempt delivery.
 */
export async function retryFailedNotifications(): Promise<void> {
  logger.info('Retry failed notifications job — not yet implemented');
  // TODO: Query notifications with status='failed', re-dispatch through channels
}
