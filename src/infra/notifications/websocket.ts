import { wsServer } from '../realtime/ws-server';
import type { ServerMessage } from '../realtime/ws-types';

export function sendWsNotification(channel: string, message: ServerMessage) {
  wsServer.broadcastToSubscribed(channel, message);
}
