import type { Notification } from '../../notifications.types';
import { wsServer } from '../../../../infra/realtime/ws-server';
import { logger } from '../../../../config/logger';

/**
 * WebSocket channel: broadcast notification to workspace subscribers.
 */
export async function deliverWebSocket(notification: Notification): Promise<void> {
  const channel = `workspace:${notification.workspaceId}`;
  wsServer.broadcastToSubscribed(channel, {
    type: 'notification' as any,
    notification: {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      metadata: notification.metadata,
      createdAt: notification.createdAt.toISOString(),
    },
  });
  logger.debug({ notificationId: notification.id, channel }, 'WebSocket notification broadcast');
}
