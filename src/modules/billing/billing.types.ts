export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

export interface PlanLimits {
  maxAgents: number;
  maxTasks: number;
  monthlyTokenBudgetUsd: number;
  maxMembers: number;
}

export interface BillingCustomer {
  id: string;
  workspaceId: string;
  stripeCustomerId: string;
  createdAt: Date;
}

export interface Subscription {
  id: string;
  workspaceId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invoice {
  id: string;
  workspaceId: string;
  stripeInvoiceId: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  pdfUrl: string | null;
  createdAt: Date;
}
