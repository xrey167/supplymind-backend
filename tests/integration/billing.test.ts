import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Billing', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Billing Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('billing_customers', 'subscriptions', 'invoices', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/billing`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET /subscription returns free plan when no subscription', async () => {
    const res = await app.request(`${base()}/subscription`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.plan).toBe('free');
  });

  it('GET /invoices returns empty list for new workspace', async () => {
    const res = await app.request(`${base()}/invoices`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual([]);
  });

  it('GET /limits returns free tier limits', async () => {
    const res = await app.request(`${base()}/limits`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.maxAgents).toBeDefined();
    expect(typeof body.data.maxAgents).toBe('number');
  });

  it('POST /checkout requires Stripe keys (returns error without them)', async () => {
    const res = await app.request(`${base()}/checkout`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        planTier: 'starter',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      }),
    });
    // Without STRIPE_SECRET_KEY, this should fail gracefully
    expect([400, 500]).toContain(res.status);
  });

  it('POST /portal requires Stripe keys (returns error without them)', async () => {
    const res = await app.request(`${base()}/portal`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ returnUrl: 'http://localhost:3000/settings' }),
    });
    expect([400, 500]).toContain(res.status);
  });
});
