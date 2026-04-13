import type { Notification } from '../../notifications.types';
import { postToSlack } from './slack.provider';

export async function deliverSlack(
  notification: Notification,
  webhookUrl: string,
): Promise<void> {
  const text = notification.body
    ? `*${notification.title}*\n${notification.body}`
    : `*${notification.title}*`;
  await postToSlack(webhookUrl, text);
}
