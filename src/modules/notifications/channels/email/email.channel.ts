import type { Notification } from '../../notifications.types';
import { sendEmail } from './email.provider';
import { notificationEmail } from './email.templates';

export async function deliverEmail(
  notification: Notification,
  recipientEmail: string,
): Promise<void> {
  const html = notificationEmail(
    notification.title,
    notification.body,
    notification.metadata,
  );
  await sendEmail({
    to: recipientEmail,
    subject: notification.title,
    html,
  });
}
