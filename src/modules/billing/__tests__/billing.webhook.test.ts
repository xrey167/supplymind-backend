import { describe, test, expect, beforeEach, mock, spyOn, afterAll } from 'bun:test';
import type Stripe from 'stripe';

// --- Mocks ---

const mockSubRetrieve = mock(() =>
  Promise.resolve({
    id: 'sub_new',
    items: { data: [{ price: { id: 'price_starter_123' } }] },
    status: 'active',
    current_period_start: 1700000000,
    current_period_end: 1702592000,
    cancel_at_period_end: false,
  }),
);

mock.module('stripe', () => ({
  default: class {
    subscriptions = { retrieve: mockSubRetrieve };
  },
}));

const mockUpsertCustomer = mock(() =>
  Promise.resolve({ id: 'bc-1', workspaceId: 'ws-1', stripeCustomerId: 'cus_1', createdAt: new Date() }),
);
const mockGetCustomerByStripeId = mock(() =>
  Promise.resolve({ id: 'bc-1', workspaceId: 'ws-1', stripeCustomerId: 'cus_1' } as any),
);
const mockUpsertSubscription = mock((..._args: any[]) => Promise.resolve({ id: 'sub-1' }));
const mockInsertInvoice = mock((..._args: any[]) => Promise.resolve({ id: 'inv-1' }));

const mockRepo = {
  getCustomer: mock(() => Promise.resolve(null)),
  upsertCustomer: mockUpsertCustomer,
  getSubscription: mock(() => Promise.resolve(null)),
  upsertSubscription: mockUpsertSubscription,
  getCustomerByStripeId: mockGetCustomerByStripeId,
  getActivePlan: mock(() => Promise.resolve('free')),
  insertInvoice: mockInsertInvoice,
  listInvoices: mock(() => Promise.resolve([])),
  getPastDueSubscriptions: mock(() => Promise.resolve([])),
};

const mockEmitCreated = mock(() => Promise.resolve());
const mockEmitUpdated = mock(() => Promise.resolve());
const mockEmitCanceled = mock(() => Promise.resolve());
const mockEmitInvoicePaid = mock(() => Promise.resolve());

mock.module('../billing.events', () => ({
  emitSubscriptionCreated: mockEmitCreated,
  emitSubscriptionUpdated: mockEmitUpdated,
  emitSubscriptionCanceled: mockEmitCanceled,
  emitInvoicePaid: mockEmitInvoicePaid,
}));

const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
};

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({ ..._realLogger, logger: mockLogger }));

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_PRICE_STARTER = 'price_starter_123';
process.env.STRIPE_PRICE_PRO = 'price_pro_456';
process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise_789';

import { BillingService } from '../billing.service';
import { WorkspaceSettingsService } from '../../settings/workspace-settings/workspace-settings.service';

const settingsSetSpy = spyOn(WorkspaceSettingsService.prototype, 'set').mockResolvedValue({} as any);
afterAll(() => { settingsSetSpy.mockRestore(); });

// --- Helpers ---

function makeEvent(type: string, object: Record<string, any>): Stripe.Event {
  return { id: 'evt_test', type, data: { object } } as unknown as Stripe.Event;
}

const NOW_S = 1700000000;
const LATER_S = 1702592000;

describe('BillingService.syncFromWebhook', () => {
  let service: BillingService;

  beforeEach(() => {
    service = new BillingService(mockRepo as any);
    mockUpsertCustomer.mockClear();
    mockGetCustomerByStripeId.mockClear();
    mockUpsertSubscription.mockClear();
    mockInsertInvoice.mockClear();
    mockSubRetrieve.mockClear();
    mockEmitCreated.mockClear();
    mockEmitUpdated.mockClear();
    mockEmitCanceled.mockClear();
    mockEmitInvoicePaid.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
    settingsSetSpy.mockClear();
  });

  test('checkout.session.completed — creates customer and syncs subscription', async () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_1',
      customer: 'cus_1',
      subscription: 'sub_new',
      metadata: { workspaceId: 'ws-1' },
    });

    await service.syncFromWebhook(event);

    expect(mockUpsertCustomer).toHaveBeenCalledWith('ws-1', 'cus_1');
    expect(mockSubRetrieve).toHaveBeenCalledWith('sub_new');
    expect(mockUpsertSubscription).toHaveBeenCalled();
    expect(mockEmitCreated).toHaveBeenCalled();
  });

  test('checkout.session.completed — skips when no workspaceId metadata', async () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_2',
      customer: 'cus_1',
      subscription: 'sub_new',
      metadata: {},
    });

    await service.syncFromWebhook(event);

    expect(mockUpsertCustomer).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test('customer.subscription.updated — syncs subscription for known customer', async () => {
    mockGetCustomerByStripeId.mockResolvedValueOnce({
      id: 'bc-1',
      workspaceId: 'ws-1',
      stripeCustomerId: 'cus_1',
    });

    const event = makeEvent('customer.subscription.updated', {
      id: 'sub_1',
      customer: 'cus_1',
      items: { data: [{ price: { id: 'price_pro_456' } }] },
      status: 'active',
      current_period_start: NOW_S,
      current_period_end: LATER_S,
      cancel_at_period_end: false,
    });

    await service.syncFromWebhook(event);

    expect(mockUpsertSubscription).toHaveBeenCalled();
    const call = mockUpsertSubscription.mock.calls[0][0] as any;
    expect(call.plan).toBe('pro');
    expect(call.status).toBe('active');
    expect(mockEmitUpdated).toHaveBeenCalled();
  });

  test('customer.subscription.updated — logs warning for unknown customer', async () => {
    mockGetCustomerByStripeId.mockResolvedValueOnce(null);

    const event = makeEvent('customer.subscription.updated', {
      id: 'sub_1',
      customer: 'cus_unknown',
      items: { data: [{ price: { id: 'price_starter_123' } }] },
      status: 'active',
      current_period_start: NOW_S,
      current_period_end: LATER_S,
      cancel_at_period_end: false,
    });

    await service.syncFromWebhook(event);

    expect(mockUpsertSubscription).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test('customer.subscription.deleted — marks canceled and syncs budget to free', async () => {
    mockGetCustomerByStripeId.mockResolvedValueOnce({
      id: 'bc-1',
      workspaceId: 'ws-1',
      stripeCustomerId: 'cus_1',
    });

    const event = makeEvent('customer.subscription.deleted', {
      id: 'sub_1',
      customer: 'cus_1',
      items: { data: [{ price: { id: 'price_starter_123' } }] },
      status: 'canceled',
      current_period_start: NOW_S,
      current_period_end: LATER_S,
    });

    await service.syncFromWebhook(event);

    expect(mockUpsertSubscription).toHaveBeenCalled();
    const call = mockUpsertSubscription.mock.calls[0][0] as any;
    expect(call.status).toBe('canceled');
    expect(call.cancelAtPeriodEnd).toBe(true);

    // syncTokenBudget called with 'free'
    expect(settingsSetSpy).toHaveBeenCalled();

    expect(mockEmitCanceled).toHaveBeenCalled();
  });

  test('invoice.paid — inserts invoice record and emits event', async () => {
    mockGetCustomerByStripeId.mockResolvedValueOnce({
      id: 'bc-1',
      workspaceId: 'ws-1',
      stripeCustomerId: 'cus_1',
    });

    const event = makeEvent('invoice.paid', {
      id: 'in_1',
      customer: 'cus_1',
      amount_due: 5000,
      amount_paid: 5000,
      currency: 'usd',
      period_start: NOW_S,
      period_end: LATER_S,
      invoice_pdf: 'https://stripe.com/pdf/in_1',
    });

    await service.syncFromWebhook(event);

    expect(mockInsertInvoice).toHaveBeenCalled();
    const call = mockInsertInvoice.mock.calls[0][0] as any;
    expect(call.status).toBe('paid');
    expect(call.amountPaid).toBe(5000);
    expect(call.pdfUrl).toBe('https://stripe.com/pdf/in_1');

    expect(mockEmitInvoicePaid).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', amountPaid: 5000 }),
    );
  });

  test('invoice.payment_failed — inserts failed invoice and logs warning', async () => {
    mockGetCustomerByStripeId.mockResolvedValueOnce({
      id: 'bc-1',
      workspaceId: 'ws-1',
      stripeCustomerId: 'cus_1',
    });

    const event = makeEvent('invoice.payment_failed', {
      id: 'in_2',
      customer: 'cus_1',
      amount_due: 5000,
      amount_paid: 0,
      currency: 'usd',
      period_start: NOW_S,
      period_end: LATER_S,
      invoice_pdf: null,
    });

    await service.syncFromWebhook(event);

    expect(mockInsertInvoice).toHaveBeenCalled();
    const call = mockInsertInvoice.mock.calls[0][0] as any;
    expect(call.status).toBe('payment_failed');
    expect(call.amountPaid).toBe(0);

    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test('unknown event type — handled gracefully with debug log', async () => {
    const event = makeEvent('some.unknown.event', { id: 'obj_1' });

    await service.syncFromWebhook(event);

    expect(mockLogger.debug).toHaveBeenCalled();
    // No errors thrown, no repo calls
    expect(mockUpsertSubscription).not.toHaveBeenCalled();
    expect(mockInsertInvoice).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
