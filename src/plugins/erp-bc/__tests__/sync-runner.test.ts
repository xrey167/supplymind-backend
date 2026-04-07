import { describe, it, expect, mock, beforeEach } from 'bun:test';

const jobStore = new Map<string, any>();
const recordStore: any[] = [];

mock.module('../../../infra/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [jobStore.get('job-1')] }) }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({ values: async (data: any) => { recordStore.push(data); } }),
  },
}));

mock.module('../../../infra/db/schema', () => ({ syncJobs: {}, syncRecords: {} }));
mock.module('../../../config/logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));
mock.module('drizzle-orm', () => ({ eq: (col: any, val: any) => ({ col, val }) }));

const { runSync } = await import('../sync/sync-runner');

const mockClient: any = {
  list: async () => ({ value: [{ id: 'po-1', number: 'PO001' }, { id: 'po-2', number: 'PO002' }] }),
};

const mockNotify = async () => {};

beforeEach(() => {
  recordStore.length = 0;
  jobStore.set('job-1', {
    id: 'job-1', workspaceId: 'ws-1', entityType: 'purchaseOrders',
    filter: null, batchSize: 100, retryCount: 0, status: 'idle',
  });
});

describe('runSync', () => {
  it('returns correct counts for fresh sync', async () => {
    const result = await runSync('job-1', mockClient, mockNotify);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.deadLettered).toBe(0);
  });

  it('writes sync_records for each entity', async () => {
    await runSync('job-1', mockClient, mockNotify);
    const created = recordStore.filter(r => r.action === 'created');
    expect(created).toHaveLength(2);
    expect(created[0].entityType).toBe('purchaseOrders');
  });
});
