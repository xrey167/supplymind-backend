import Stripe from 'stripe';
import { billingService } from '../../modules/billing/billing.service';
import { logger } from '../../config/logger';

export async function handleStripeWebhook(rawBody: string, signature: string): Promise<void> {
  const secret = Bun.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  const stripe = new Stripe(Bun.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-03-31.basil' as any,
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Stripe webhook signature verification failed');
    throw new Error('Invalid webhook signature');
  }

  await billingService.syncFromWebhook(event);
}
