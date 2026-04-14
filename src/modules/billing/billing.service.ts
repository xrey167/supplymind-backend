import Stripe from 'stripe';
import { billingRepo } from './billing.repo';
import { PLAN_LIMITS, getPlanFromPriceId } from './billing.plans';
import {
  emitSubscriptionCreated,
  emitSubscriptionUpdated,
  emitSubscriptionCanceled,
  emitInvoicePaid,
} from './billing.events';
import { logger } from '../../config/logger';
import { getBudgetCounter } from '../../infra/billing/budget-counter';
import type { PlanTier, PlanLimits, SubscriptionStatus } from './billing.types';

function getStripe(): Stripe {
  const key = Bun.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(key, { apiVersion: '2025-03-31.basil' as any });
}

function getPriceId(planTier: PlanTier): string {
  const envMap: Record<string, string | undefined> = {
    starter: Bun.env.STRIPE_PRICE_STARTER,
    pro: Bun.env.STRIPE_PRICE_PRO,
    enterprise: Bun.env.STRIPE_PRICE_ENTERPRISE,
  };
  const priceId = envMap[planTier];
  if (!priceId) throw new Error(`No Stripe price configured for plan: ${planTier}`);
  return priceId;
}

async function syncTokenBudget(workspaceId: string, plan: PlanTier) {
  try {
    const { WorkspaceSettingsService } = await import('../settings/workspace-settings/workspace-settings.service');
    const settingsService = new WorkspaceSettingsService();
    const limits = PLAN_LIMITS[plan];
    const budgetCents = limits.monthlyTokenBudgetUsd === -1
      ? -1
      : limits.monthlyTokenBudgetUsd * 100;
    await settingsService.set(workspaceId, 'TOKEN_BUDGET' as any, {
      monthlyLimitCents: budgetCents,
      warningPct: 80,
    });
    logger.info({ workspaceId, plan, budgetCents }, 'Synced token budget from plan');
  } catch (err) {
    logger.error({ workspaceId, plan, err }, 'Failed to sync token budget — plan upgrade may not be reflected');
  }
}

export class BillingService {
  private repo: typeof billingRepo;

  constructor(repo?: typeof billingRepo) {
    this.repo = repo ?? billingRepo;
  }

  async createCheckoutSession(
    workspaceId: string,
    planTier: PlanTier,
    urls: { successUrl: string; cancelUrl: string },
  ) {
    const stripe = getStripe();
    let customer = await this.repo.getCustomer(workspaceId);

    if (!customer) {
      const stripeCustomer = await stripe.customers.create({
        metadata: { workspaceId },
      });
      customer = await this.repo.upsertCustomer(workspaceId, stripeCustomer.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customer.stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: getPriceId(planTier), quantity: 1 }],
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      metadata: { workspaceId, planTier },
    });

    return { url: session.url, sessionId: session.id };
  }

  async createPortalSession(workspaceId: string, returnUrl: string) {
    const stripe = getStripe();
    const customer = await this.repo.getCustomer(workspaceId);
    if (!customer) throw new Error('No billing customer found for workspace');

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  async getSubscriptionStatus(workspaceId: string) {
    const sub = await this.repo.getSubscription(workspaceId);
    if (!sub) return { plan: 'free' as PlanTier, status: null, subscription: null };
    return {
      plan: sub.plan as PlanTier,
      status: sub.status as SubscriptionStatus,
      subscription: sub,
    };
  }

  async syncFromWebhook(event: Stripe.Event) {
    logger.info({ type: event.type, id: event.id }, 'Processing Stripe webhook');

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        logger.debug({ type: event.type }, 'Unhandled Stripe event type');
    }
  }

  getPlanLimits(planTier: PlanTier): PlanLimits {
    return PLAN_LIMITS[planTier];
  }

  async checkTokenBudget(workspaceId: string): Promise<{ allowed: boolean; reason?: string }> {
    const plan = await this.repo.getActivePlan(workspaceId);
    const limits = PLAN_LIMITS[plan];
    if (limits.monthlyTokenBudgetUsd === -1) return { allowed: true }; // enterprise: unlimited
    if (limits.monthlyTokenBudgetUsd === 0) return { allowed: true }; // no budget set

    // Redis fast-path: if the atomic counter already shows we are over budget,
    // return immediately without hitting the database.
    let redisSpend = 0;
    try {
      redisSpend = await this.getBudgetCounter(workspaceId);
    } catch (err) {
      logger.warn({ workspaceId, err }, 'checkTokenBudget: Redis counter read failed, falling back to DB');
    }

    if (redisSpend >= limits.monthlyTokenBudgetUsd) {
      return {
        allowed: false,
        reason: `Monthly token budget of $${limits.monthlyTokenBudgetUsd} exceeded (spent $${redisSpend.toFixed(4)})`,
      };
    }

    // Redis counter is 0 (cold start / key expired) or below budget — confirm with DB.
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1); // first of current month
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); // last ms of month

    const spentUsd = await this.repo.totalCost(workspaceId, periodStart, periodEnd);
    if (spentUsd >= limits.monthlyTokenBudgetUsd) {
      return {
        allowed: false,
        reason: `Monthly token budget of $${limits.monthlyTokenBudgetUsd} exceeded (spent $${spentUsd.toFixed(4)})`,
      };
    }
    return { allowed: true };
  }

  /** Exposed for testing — allows injecting a mock budget counter. */
  protected async getBudgetCounter(workspaceId: string): Promise<number> {
    return getBudgetCounter(workspaceId);
  }

  async enforceLimits(workspaceId: string) {
    const plan = await this.repo.getActivePlan(workspaceId);
    const limits = PLAN_LIMITS[plan];
    if (limits.maxAgents === -1) return { allowed: true, plan, limits };

    // Dynamic import to avoid circular deps
    const { AgentsRepository } = await import('../agents/agents.repo');
    const agentsRepo = new AgentsRepository();
    const agents = await agentsRepo.findByWorkspace(workspaceId);

    if (agents.length >= limits.maxAgents) {
      return { allowed: false, plan, limits, reason: `Agent limit reached (${limits.maxAgents})` };
    }
    return { allowed: true, plan, limits };
  }

  // --- private handlers ---

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const workspaceId = session.metadata?.workspaceId;
    const customerId = session.customer as string;
    if (!workspaceId) {
      logger.warn({ sessionId: session.id }, 'Checkout session missing workspaceId metadata');
      return;
    }

    await this.repo.upsertCustomer(workspaceId, customerId);

    if (session.subscription) {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      await this.syncSubscription(workspaceId, sub, true);
    }
  }

  private async handleSubscriptionUpdated(sub: Stripe.Subscription) {
    const customer = await this.repo.getCustomerByStripeId(sub.customer as string);
    if (!customer) {
      logger.warn({ customerId: sub.customer }, 'Subscription update for unknown customer');
      return;
    }
    await this.syncSubscription(customer.workspaceId, sub, false);
  }

  private async handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const customer = await this.repo.getCustomerByStripeId(sub.customer as string);
    if (!customer) {
      logger.warn({ customerId: sub.customer, event: 'subscription.deleted' }, 'Webhook for unknown customer');
      return;
    }

    const priceId = sub.items.data[0]?.price.id ?? '';
    const plan = getPlanFromPriceId(priceId);

    await this.repo.upsertSubscription({
      workspaceId: customer.workspaceId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      plan,
      status: 'canceled',
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: true,
    });

    await syncTokenBudget(customer.workspaceId, 'free');

    await emitSubscriptionCanceled({
      workspaceId: customer.workspaceId,
      plan,
      status: 'canceled',
      stripeSubscriptionId: sub.id,
    });
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    const customer = await this.repo.getCustomerByStripeId(invoice.customer as string);
    if (!customer) {
      logger.warn({ customerId: invoice.customer, event: 'invoice.paid' }, 'Webhook for unknown customer');
      return;
    }

    await this.repo.insertInvoice({
      workspaceId: customer.workspaceId,
      stripeInvoiceId: invoice.id,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      status: 'paid',
      periodStart: new Date(invoice.period_start * 1000),
      periodEnd: new Date(invoice.period_end * 1000),
      pdfUrl: invoice.invoice_pdf ?? null,
    });

    await emitInvoicePaid({
      workspaceId: customer.workspaceId,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      stripeInvoiceId: invoice.id,
    });
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const customer = await this.repo.getCustomerByStripeId(invoice.customer as string);
    if (!customer) {
      logger.warn({ customerId: invoice.customer, event: 'invoice.payment_failed' }, 'Webhook for unknown customer');
      return;
    }

    await this.repo.insertInvoice({
      workspaceId: customer.workspaceId,
      stripeInvoiceId: invoice.id,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      status: 'payment_failed',
      periodStart: new Date(invoice.period_start * 1000),
      periodEnd: new Date(invoice.period_end * 1000),
      pdfUrl: invoice.invoice_pdf ?? null,
    });

    logger.warn({ workspaceId: customer.workspaceId, invoiceId: invoice.id }, 'Invoice payment failed');
  }

  private async syncSubscription(workspaceId: string, sub: Stripe.Subscription, isNew: boolean) {
    const priceId = sub.items.data[0]?.price.id ?? '';
    const plan = getPlanFromPriceId(priceId);
    const status = sub.status as SubscriptionStatus;

    await this.repo.upsertSubscription({
      workspaceId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      plan,
      status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });

    await syncTokenBudget(workspaceId, plan);

    const eventData = { workspaceId, plan, status, stripeSubscriptionId: sub.id };
    if (isNew) {
      await emitSubscriptionCreated(eventData);
    } else {
      await emitSubscriptionUpdated(eventData);
    }
  }
}

export const billingService = new BillingService();
