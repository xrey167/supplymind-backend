import { logger } from '../../../../config/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(
  message: EmailMessage,
): Promise<{ id: string } | null> {
  const apiKey = Bun.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('RESEND_API_KEY not set — email not sent');
    return null;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from ?? 'SupplyMind <noreply@supplymind.ai>',
      to: [message.to],
      subject: message.subject,
      html: message.html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, 'Failed to send email via Resend');
    return null;
  }

  const data = (await res.json()) as { id: string };
  return { id: data.id };
}
