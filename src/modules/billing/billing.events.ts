import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import type { PlanTier, SubscriptionStatus } from './billing.types';

export interface SubscriptionEventData {
  workspaceId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  stripeSubscriptionId: string;
}

export interface InvoicePaidEventData {
  workspaceId: string;
  amountPaid: number;
  currency: string;
  stripeInvoiceId: string;
}

export function emitSubscriptionCreated(data: SubscriptionEventData) {
  return eventBus.publish(Topics.SUBSCRIPTION_CREATED, data, { source: 'billing' });
}

export function emitSubscriptionUpdated(data: SubscriptionEventData) {
  return eventBus.publish(Topics.SUBSCRIPTION_UPDATED, data, { source: 'billing' });
}

export function emitSubscriptionCanceled(data: SubscriptionEventData) {
  return eventBus.publish(Topics.SUBSCRIPTION_CANCELED, data, { source: 'billing' });
}

export function emitInvoicePaid(data: InvoicePaidEventData) {
  return eventBus.publish(Topics.INVOICE_PAID, data, { source: 'billing' });
}
