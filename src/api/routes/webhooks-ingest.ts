import { Hono } from 'hono';
import { webhooksService } from '../../modules/webhooks/webhooks.service';

// Raw ingest route — no auth middleware, HMAC signature is the auth
export const webhookIngestRoute = new Hono();

webhookIngestRoute.post('/:token', async (c) => {
  const token = c.req.param('token');
  const rawBody = await c.req.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const signature =
    c.req.header('x-hub-signature-256') ??
    c.req.header('x-signature-256') ??
    c.req.header('x-signature') ??
    '';

  const deliveryKey = c.req.header('x-delivery-id') ?? '';

  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => { headers[key] = value; });

  const result = await webhooksService.verifyAndIngest({
    token,
    rawBody,
    signature,
    deliveryKey,
    payload,
    headers,
  });

  if (!result.accepted) return c.json({ error: 'Invalid signature or unknown endpoint' }, 400);
  if (result.duplicate) return c.json({ status: 'duplicate' }, 200);
  return c.json({ status: 'accepted' }, 200);
});
