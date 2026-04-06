import { describe, it, expect } from 'bun:test';

describe('Clerk webhook handler', () => {
  it('returns 501 when CLERK_WEBHOOK_SECRET is not set', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const { clerkWebhookRoutes } = await import('../clerk');
    const res = await clerkWebhookRoutes.request('/', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(501);
  });

  it('returns 400 when svix headers are missing', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'test-secret';
    const { clerkWebhookRoutes } = await import('../clerk');
    const res = await clerkWebhookRoutes.request('/', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    delete process.env.CLERK_WEBHOOK_SECRET;
  });
});
