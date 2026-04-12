import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../../../core/types';
import { usersService } from '../../../modules/users/users.service';
import { logger } from '../../../config/logger';
import type { ClerkWebhookEvent } from '../../../modules/users/users.types';

export const clerkWebhookRoutes = new OpenAPIHono<AppEnv>();

clerkWebhookRoutes.post('/', async (c) => {
  const secret = Bun.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: 'Webhook verification not configured' }, 501);
  }

  const payload = await c.req.text();
  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: 'Missing webhook signature headers' }, 400);
  }

  let event: ClerkWebhookEvent;
  try {
    let Webhook: any;
    try {
      const clerk = await import('@clerk/backend');
      Webhook = (clerk as any).Webhook;
    } catch {
      const svix = await import('svix');
      Webhook = svix.Webhook;
    }

    const wh = new Webhook(secret);
    event = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    logger.warn({ err }, 'Clerk webhook: signature verification failed');
    return c.json({ error: 'Invalid webhook signature' }, 401);
  }

  try {
    await usersService.syncFromClerk(event);
    logger.info({ type: event.type, userId: event.data.id }, 'Clerk webhook processed');
    return c.json({ received: true });
  } catch (err) {
    logger.error({ err, type: event.type }, 'Clerk webhook: processing failed');
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});
