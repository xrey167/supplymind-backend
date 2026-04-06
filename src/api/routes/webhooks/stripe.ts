import { OpenAPIHono } from '@hono/zod-openapi';
import { handleStripeWebhook } from '../../../infra/webhooks/stripe';
import { logger } from '../../../config/logger';

export const stripeWebhookRoutes = new OpenAPIHono();

stripeWebhookRoutes.post('/', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  const rawBody = await c.req.text();
  try {
    await handleStripeWebhook(rawBody, signature);
    return c.json({ received: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Stripe webhook processing failed');
    return c.json({ error: err.message }, 400);
  }
});
