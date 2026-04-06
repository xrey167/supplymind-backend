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
const mockGetCustomer = mock(() => Promise.resolve(null));
const mockUpsertCustomer = mock(() => Promise.resolve({ id: 'bc-1', workspaceId: 'ws-1', stripeCustomerId: 'cus_test123', createdAt: new Date() }));
const mockGetSubscription = mock(() => Promise.resolve(null));
const mockUpsertSubscription = mock(() => Promise.resolve({ id: 'sub-1' }));
const mockGetCustomerByStripeId = mock(() => Promise.resolve({ id: 'bc-1', workspaceId: 'ws-1', stripeCustomerId: 'cus_test123' }));
const mockGetActivePlan = mock(() => Promise.resolve('free' as PlanTier));

mock.module('../billing.repo', () => ({
  billingRepo: {
    getCustomer: mockGetCustomer,
    upsertCustomer: mockUpsertCustomer,
    getSubscription: mockGetSubscription,
    upsertSubscription: mockUpsertSubscription,
    getCustomerByStripeId: mockGetCustomerByStripeId,
    getActivePlan: mockGetActivePlan,
    insertInvoice: mock(() => Promise.resolve({ id: 'inv-1' })),
    listInvoices: mock(() => Promise.resolve([])),
    getPastDueSubscriptions: mock(() => Promise.resolve([])),
  },
  BillingRepository: class {},
}));

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
    service = new BillingService();
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
});
