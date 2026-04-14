import { describe, test, expect, beforeEach, mock, spyOn, afterAll } from 'bun:test';
import type { PlanTier } from '../billing.types';

// Mock Stripe
const mockCheckoutCreate = mock(() => Promise.resolve({ url: 'https://checkout.stripe.com/test', id: 'cs_test' }));
const mockPortalCreate = mock(() => Promise.resolve({ url: 'https://billing.stripe.com/portal' }));
const mockCustomerCreate = mock(() => Promise.resolve({ id: 'cus_test123' }));
const mockSubRetrieve = mock(() =>
  Promise.resolve({
    id: 'sub_test',
    items: { data: [{ price: { id: 'price_starter_123' } }] },
    status: 'active',
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    cancel_at_period_end: false,
  }),
);

mock.module('stripe', () => ({
  default: class {
    checkout = { sessions: { create: mockCheckoutCreate } };
    billingPortal = { sessions: { create: mockPortalCreate } };
    customers = { create: mockCustomerCreate };
    subscriptions = { retrieve: mockSubRetrieve };
    webhooks = { constructEvent: mock((_body: string, _sig: string, _secret: string) => ({ type: 'checkout.session.completed', id: 'evt_1', data: { object: {} } })) };
  },
}));

// Mock repo
const mockGetCustomer = mock(() => Promise.resolve(null as any));
const mockUpsertCustomer = mock(() => Promise.resolve({ id: 'bc-1', workspaceId: 'ws-1', stripeCustomerId: 'cus_test123', createdAt: new Date() }));
const mockGetSubscription = mock(() => Promise.resolve(null));
const mockUpsertSubscription = mock(() => Promise.resolve({ id: 'sub-1' }));
const mockGetCustomerByStripeId = mock(() => Promise.resolve({ id: 'bc-1', workspaceId: 'ws-1', stripeCustomerId: 'cus_test123' }));
const mockGetActivePlan = mock(() => Promise.resolve('free' as PlanTier));

const mockTotalCost = mock(() => Promise.resolve(0));

const mockRepo = {
  getCustomer: mockGetCustomer,
  upsertCustomer: mockUpsertCustomer,
  getSubscription: mockGetSubscription,
  upsertSubscription: mockUpsertSubscription,
  getCustomerByStripeId: mockGetCustomerByStripeId,
  getActivePlan: mockGetActivePlan,
  insertInvoice: mock(() => Promise.resolve({ id: 'inv-1' })),
  listInvoices: mock(() => Promise.resolve([])),
  getPastDueSubscriptions: mock(() => Promise.resolve([])),
  totalCost: mockTotalCost,
};

// Mock events
mock.module('../billing.events', () => ({
  emitSubscriptionCreated: mock(() => Promise.resolve()),
  emitSubscriptionUpdated: mock(() => Promise.resolve()),
  emitSubscriptionCanceled: mock(() => Promise.resolve()),
  emitInvoicePaid: mock(() => Promise.resolve()),
}));

// Mock logger
mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Set env vars
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_PRICE_STARTER = 'price_starter_123';
process.env.STRIPE_PRICE_PRO = 'price_pro_456';
process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise_789';

import { BillingService } from '../billing.service';
import { WorkspaceSettingsService } from '../../settings/workspace-settings/workspace-settings.service';

const settingsSetSpy = spyOn(WorkspaceSettingsService.prototype, 'set').mockResolvedValue({} as any);
afterAll(() => { settingsSetSpy.mockRestore(); });

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(() => {
    service = new BillingService(mockRepo as any);
    mockGetCustomer.mockClear();
    mockUpsertCustomer.mockClear();
    mockCustomerCreate.mockClear();
  });

  describe('createCheckoutSession', () => {
    test('creates a new Stripe customer when none exists', async () => {
      mockGetCustomer.mockResolvedValueOnce(null);
      const result = await service.createCheckoutSession('ws-1', 'starter', {
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      });
      expect(result.url).toBe('https://checkout.stripe.com/test');
      expect(result.sessionId).toBe('cs_test');
      expect(mockUpsertCustomer).toHaveBeenCalled();
    });

    test('reuses existing Stripe customer', async () => {
      mockGetCustomer.mockResolvedValueOnce({
        id: 'bc-1',
        workspaceId: 'ws-1',
        stripeCustomerId: 'cus_existing',
        createdAt: new Date(),
      });
      const result = await service.createCheckoutSession('ws-1', 'pro', {
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      });
      expect(result.url).toBeDefined();
      // Should not create a new customer
      expect(mockCustomerCreate).not.toHaveBeenCalled();
    });
  });

  describe('createPortalSession', () => {
    test('throws when no customer exists', async () => {
      mockGetCustomer.mockResolvedValueOnce(null);
      // The method calls billingRepo.getCustomer which returns null
      await expect(service.createPortalSession('ws-1', 'https://app.test')).rejects.toThrow(
        'No billing customer found',
      );
    });

    test('returns portal URL when customer exists', async () => {
      mockGetCustomer.mockResolvedValueOnce({
        id: 'bc-1',
        workspaceId: 'ws-1',
        stripeCustomerId: 'cus_test123',
        createdAt: new Date(),
      });
      const result = await service.createPortalSession('ws-1', 'https://app.test');
      expect(result.url).toBe('https://billing.stripe.com/portal');
    });
  });

  describe('getSubscriptionStatus', () => {
    test('returns free plan when no subscription', async () => {
      mockGetSubscription.mockResolvedValueOnce(null);
      const result = await service.getSubscriptionStatus('ws-1');
      expect(result.plan).toBe('free');
      expect(result.status).toBeNull();
    });
  });

  describe('getPlanLimits', () => {
    test('returns limits for each plan tier', () => {
      const free = service.getPlanLimits('free');
      expect(free.maxAgents).toBe(2);

      const enterprise = service.getPlanLimits('enterprise');
      expect(enterprise.maxAgents).toBe(-1);
    });
  });

  describe('enforceLimits', () => {
    test('returns allowed when under limit', async () => {
      mockGetActivePlan.mockResolvedValueOnce('starter');
      // Mock agents module
      mock.module('../../agents/agents.repo', () => ({
        AgentsRepository: class {
          findByWorkspace = mock(() => Promise.resolve([{ id: '1' }, { id: '2' }]));
        },
      }));
      const result = await service.enforceLimits('ws-1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkTokenBudget', () => {
    // Use a fresh BillingService with a fresh repo mock per describe block to
    // avoid cross-test state leakage from the outer beforeEach.
    const tcMock = mock(() => Promise.resolve(0 as number));
    const planMock = mock(() => Promise.resolve('free' as PlanTier));
    let svc: BillingService;

    beforeEach(() => {
      tcMock.mockReset();
      tcMock.mockImplementation(() => Promise.resolve(0));
      planMock.mockReset();
      planMock.mockImplementation(() => Promise.resolve('free' as PlanTier));
      svc = new BillingService({ ...mockRepo, getActivePlan: planMock, totalCost: tcMock } as any);
    });

    test('enterprise plan (unlimited) → always allowed without querying spend', async () => {
      planMock.mockImplementation(() => Promise.resolve('enterprise' as PlanTier));
      tcMock.mockImplementation(() => Promise.resolve(9999));
      const result = await svc.checkTokenBudget('ws-1');
      expect(result.allowed).toBe(true);
      expect(tcMock).not.toHaveBeenCalled();
    });

    test('free plan spend below budget → allowed', async () => {
      planMock.mockImplementation(() => Promise.resolve('free' as PlanTier)); // budget = $5
      tcMock.mockImplementation(() => Promise.resolve(3.5));
      const result = await svc.checkTokenBudget('ws-1');
      expect(result.allowed).toBe(true);
    });

    test('spend equals budget → not allowed', async () => {
      planMock.mockImplementation(() => Promise.resolve('free' as PlanTier)); // budget = $5
      tcMock.mockImplementation(() => Promise.resolve(5));
      const result = await svc.checkTokenBudget('ws-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
    });

    test('spend exceeds budget → not allowed with reason', async () => {
      planMock.mockImplementation(() => Promise.resolve('starter' as PlanTier)); // budget = $50
      tcMock.mockImplementation(() => Promise.resolve(52.75));
      const result = await svc.checkTokenBudget('ws-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('$50');
    });

    test('no spend yet (totalCost = 0) → allowed', async () => {
      planMock.mockImplementation(() => Promise.resolve('pro' as PlanTier)); // budget = $500
      tcMock.mockImplementation(() => Promise.resolve(0));
      const result = await svc.checkTokenBudget('ws-1');
      expect(result.allowed).toBe(true);
    });

    test('totalCost is called with workspace id and current-month period', async () => {
      planMock.mockImplementation(() => Promise.resolve('starter' as PlanTier));
      tcMock.mockImplementation(() => Promise.resolve(10));
      await svc.checkTokenBudget('ws-billing-period');
      expect(tcMock).toHaveBeenCalledTimes(1);
      const [wsId, start, end] = (tcMock as any).mock.calls[0];
      expect(wsId).toBe('ws-billing-period');
      // Period start is the 1st of the current month
      const now = new Date();
      expect(start.getFullYear()).toBe(now.getFullYear());
      expect(start.getMonth()).toBe(now.getMonth());
      expect(start.getDate()).toBe(1);
      // Period end is in the same month
      expect(end.getMonth()).toBe(now.getMonth());
    });
  });
});
