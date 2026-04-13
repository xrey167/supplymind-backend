import type { Notification } from '../../notifications.types';
import { postToTelegram } from './telegram.provider';

export async function deliverTelegram(
  notification: Notification,
  botToken: string,
  chatId: string,
): Promise<void> {
  const text = notification.body
    ? `*${notification.title}*\n${notification.body}`
    : `*${notification.title}*`;
  await postToTelegram(botToken, chatId, text);
}
