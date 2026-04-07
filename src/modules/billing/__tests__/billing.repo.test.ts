import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Mock drizzle-orm to prevent actual DB calls
const mockRows: any[] = [];
const mockReturningRows: any[] = [{ id: 'test-id' }];

const mockOffset = mock(() => Promise.resolve(mockRows));
const mockLimit = mock(() => ({ offset: mockOffset }));
const mockOrderBy = mock(() => ({ limit: mockLimit }));
const mockWhere = mock(() => Promise.resolve(mockRows));
const mockFrom = mock(() => ({ where: mockWhere, orderBy: mockOrderBy }));
const mockSelect = mock(() => ({ from: mockFrom }));

const mockReturning = mock(() => Promise.resolve(mockReturningRows));
const mockOnConflict = mock(() => ({ returning: mockReturning }));
const mockValues = mock(() => ({ onConflictDoUpdate: mockOnConflict, returning: mockReturning }));
const mockInsert = mock(() => ({ values: mockValues }));

mock.module('../../../infra/db/client', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
}));

// Use dynamic import so mock.module is registered before the module is evaluated
const { BillingRepository } = await import('../billing.repo');

describe('BillingRepository', () => {
  let repo: InstanceType<typeof BillingRepository>;

  beforeEach(() => {
    repo = new BillingRepository();
    mockRows.length = 0;
  });

  test('getActivePlan returns free when no subscription', async () => {
    // mockWhere returns empty array by default
    const plan = await repo.getActivePlan('workspace-1');
    expect(plan).toBe('free');
  });

  test('getActivePlan returns plan when active subscription exists', async () => {
    mockWhere.mockResolvedValueOnce([{
      id: 'sub-1',
      workspaceId: 'ws-1',
      plan: 'pro',
      status: 'active',
    }]);
    const plan = await repo.getActivePlan('ws-1');
    expect(plan).toBe('pro');
  });

  test('getActivePlan returns free for canceled subscription', async () => {
    mockWhere.mockResolvedValueOnce([{
      id: 'sub-1',
      workspaceId: 'ws-1',
      plan: 'pro',
      status: 'canceled',
    }]);
    const plan = await repo.getActivePlan('ws-1');
    expect(plan).toBe('free');
  });

  test('instance methods exist', () => {
    expect(typeof repo.getCustomer).toBe('function');
    expect(typeof repo.upsertCustomer).toBe('function');
    expect(typeof repo.getSubscription).toBe('function');
    expect(typeof repo.upsertSubscription).toBe('function');
    expect(typeof repo.insertInvoice).toBe('function');
    expect(typeof repo.listInvoices).toBe('function');
    expect(typeof repo.getActivePlan).toBe('function');
    expect(typeof repo.getPastDueSubscriptions).toBe('function');
    expect(typeof repo.getCustomerByStripeId).toBe('function');
  });
});
