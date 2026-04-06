import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { billingService } from './billing.service';
import { createCheckoutSchema, portalSessionSchema, invoiceListSchema } from './billing.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const checkoutRoute = createRoute({
  method: 'post',
  path: '/checkout',
  request: { body: { content: { 'application/json': { schema: createCheckoutSchema } } } },
  responses: { 200: { description: 'Checkout session URL', ...jsonRes } },
});

const portalRoute = createRoute({
  method: 'post',
  path: '/portal',
  request: { body: { content: { 'application/json': { schema: portalSessionSchema } } } },
  responses: { 200: { description: 'Portal session URL', ...jsonRes } },
});

const subscriptionRoute = createRoute({
  method: 'get',
  path: '/subscription',
  responses: { 200: { description: 'Current subscription', ...jsonRes } },
});

const invoicesRoute = createRoute({
  method: 'get',
  path: '/invoices',
  request: { query: invoiceListSchema },
  responses: { 200: { description: 'Invoice list', ...jsonRes } },
});

const limitsRoute = createRoute({
  method: 'get',
  path: '/limits',
  responses: { 200: { description: 'Current plan limits', ...jsonRes } },
});

export const BillingRoutes = new OpenAPIHono();

BillingRoutes.openapi(checkoutRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId' as any);
  if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
  try {
    const result = await billingService.createCheckoutSession(workspaceId, body.planTier, {
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });
    return c.json({ data: result });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

BillingRoutes.openapi(portalRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId' as any);
  if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
  try {
    const result = await billingService.createPortalSession(workspaceId, body.returnUrl);
    return c.json({ data: result });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

BillingRoutes.openapi(subscriptionRoute, async (c) => {
  const workspaceId = c.get('workspaceId' as any);
  if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
  const result = await billingService.getSubscriptionStatus(workspaceId);
  return c.json({ data: result });
});

BillingRoutes.openapi(invoicesRoute, async (c) => {
  const workspaceId = c.get('workspaceId' as any);
  if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
  const query = c.req.valid('query');
  const { billingRepo } = await import('./billing.repo');
  const data = await billingRepo.listInvoices(workspaceId, query.limit, query.offset);
  return c.json({ data });
});

BillingRoutes.openapi(limitsRoute, async (c) => {
  const workspaceId = c.get('workspaceId' as any);
  if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);
  const { billingRepo } = await import('./billing.repo');
  const plan = await billingRepo.getActivePlan(workspaceId);
  const limits = billingService.getPlanLimits(plan);
  return c.json({ data: { plan, limits } });
});
