import { logger } from '../../../../config/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export type EmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: string };

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = Bun.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('RESEND_API_KEY not set — email not sent');
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }

  try {
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
      return { sent: false, reason: `Resend API error: ${res.status}` };
    }

    const data = (await res.json()) as { id: string };
    return { sent: true, id: data.id };
  } catch (err) {
    logger.error({ err }, 'Email send failed');
    return { sent: false, reason: err instanceof Error ? err.message : 'Unknown error' };
  }
}
