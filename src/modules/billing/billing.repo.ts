import { eq, desc } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { billingCustomers, subscriptions, invoices } from '../../infra/db/schema';
import type { PlanTier } from './billing.types';

export class BillingRepository {
  async getCustomer(workspaceId: string) {
    const rows = await db.select().from(billingCustomers).where(eq(billingCustomers.workspaceId, workspaceId));
    return rows[0] ?? null;
  }

  async upsertCustomer(workspaceId: string, stripeCustomerId: string) {
    const rows = await db
      .insert(billingCustomers)
      .values({ workspaceId, stripeCustomerId })
      .onConflictDoUpdate({
        target: billingCustomers.workspaceId,
        set: { stripeCustomerId },
      })
      .returning();
    return rows[0]!;
  }

  async getCustomerByStripeId(stripeCustomerId: string) {
    const rows = await db.select().from(billingCustomers).where(eq(billingCustomers.stripeCustomerId, stripeCustomerId));
    return rows[0] ?? null;
  }

  async getSubscription(workspaceId: string) {
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    return rows[0] ?? null;
  }

  async getSubscriptionByStripeId(stripeSubscriptionId: string) {
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
    return rows[0] ?? null;
  }

  async upsertSubscription(data: {
    workspaceId: string;
    stripeSubscriptionId: string;
    stripePriceId: string;
    plan: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
  }) {
    const rows = await db
      .insert(subscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: {
          stripePriceId: data.stripePriceId,
          plan: data.plan,
          status: data.status,
          currentPeriodStart: data.currentPeriodStart,
          currentPeriodEnd: data.currentPeriodEnd,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0]!;
  }

  async insertInvoice(data: {
    workspaceId: string;
    stripeInvoiceId: string;
    amountDue: number;
    amountPaid: number;
    currency: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
    pdfUrl: string | null;
  }) {
    const rows = await db
      .insert(invoices)
      .values(data)
      .onConflictDoUpdate({
        target: invoices.stripeInvoiceId,
        set: {
          amountPaid: data.amountPaid,
          status: data.status,
          pdfUrl: data.pdfUrl,
        },
      })
      .returning();
    return rows[0]!;
  }

  async listInvoices(workspaceId: string, limit = 20, offset = 0) {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.workspaceId, workspaceId))
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getActivePlan(workspaceId: string): Promise<PlanTier> {
    const sub = await this.getSubscription(workspaceId);
    if (!sub) return 'free';
    if (sub.status === 'active' || sub.status === 'trialing') return sub.plan as PlanTier;
    return 'free';
  }

  async getPastDueSubscriptions() {
    return db.select().from(subscriptions).where(eq(subscriptions.status, 'past_due'));
  }
}

export const billingRepo = new BillingRepository();
