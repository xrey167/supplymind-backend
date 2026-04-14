import { describe, it, expect, mock, beforeEach } from 'bun:test';

const jobStore = new Map<string, any>();
const recordStore: any[] = [];
const updateSets: any[] = [];

mock.module('../../../infra/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [jobStore.get('job-1')],
        }),
      }),
    }),
    update: () => ({
      set: (data: any) => {
        updateSets.push(data);
        return { where: async () => {} };
      },
    }),
    insert: () => ({
      values: async (data: any) => {
        recordStore.push(data);
        return { onConflictDoNothing: async () => {} };
      },
    }),
  },
}));

mock.module('../../../infra/db/schema', () => ({ syncJobs: {}, syncRecords: {} }));
mock.module('../../../config/logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));
mock.module('drizzle-orm', () => ({ eq: (col: any, val: any) => ({ col, val }) }));

const { runSync } = await import('../sync/sync-runner');

const mockNotify = async () => {};

function makeJob(overrides: Record<string, any> = {}) {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    entityType: 'purchaseOrders',
    filter: null,
    batchSize: 100,
    retryCount: 0,
    status: 'idle',
    cursor: null,
    ...overrides,
  };
}

beforeEach(() => {
  recordStore.length = 0;
  updateSets.length = 0;
  jobStore.set('job-1', makeJob());
});

// ---------------------------------------------------------------------------
// Existing tests (preserved)
// ---------------------------------------------------------------------------
describe('runSync', () => {
  it('returns correct counts for fresh sync', async () => {
    const client: any = {
      list: async () => ({ value: [{ id: 'po-1', number: 'PO001' }, { id: 'po-2', number: 'PO002' }] }),
    };
    const result = await runSync('job-1', client, mockNotify);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.deadLettered).toBe(0);
  });

  it('writes sync_records for each entity', async () => {
    const client: any = {
      list: async () => ({ value: [{ id: 'po-1', number: 'PO001' }, { id: 'po-2', number: 'PO002' }] }),
    };
    await runSync('job-1', client, mockNotify);
    const created = recordStore.filter(r => r.action === 'created');
    expect(created).toHaveLength(2);
    expect(created[0].entityType).toBe('purchaseOrders');
  });
});

// ---------------------------------------------------------------------------
// Cursor-based incremental sync tests
// ---------------------------------------------------------------------------
describe('runSync — cursor-based incremental sync', () => {
  it('includes lastModifiedDateTime filter when job has a cursor', async () => {
    jobStore.set('job-1', makeJob({ cursor: '2024-01-15T10:00:00Z' }));

    let capturedOpts: any;
    const client: any = {
      list: async (_entitySet: any, opts: any) => {
        capturedOpts = opts;
        return { value: [] };
      },
    };

    await runSync('job-1', client, mockNotify);

    expect(capturedOpts.filter).toBeDefined();
    expect(capturedOpts.filter).toContain('lastModifiedDateTime gt 2024-01-15T10:00:00Z');
  });

  it('combines cursor filter with existing job filter using " and "', async () => {
    jobStore.set('job-1', makeJob({ cursor: '2024-01-15T10:00:00Z', filter: 'status eq \'Open\'' }));

    let capturedOpts: any;
    const client: any = {
      list: async (_entitySet: any, opts: any) => {
        capturedOpts = opts;
        return { value: [] };
      },
    };

    await runSync('job-1', client, mockNotify);

    expect(capturedOpts.filter).toContain('lastModifiedDateTime gt 2024-01-15T10:00:00Z');
    expect(capturedOpts.filter).toContain(' and ');
    expect(capturedOpts.filter).toContain('status eq \'Open\'');
  });

  it('does NOT include lastModifiedDateTime filter when no cursor (first run)', async () => {
    jobStore.set('job-1', makeJob({ cursor: null }));

    let capturedOpts: any;
    const client: any = {
      list: async (_entitySet: any, opts: any) => {
        capturedOpts = opts;
        return { value: [] };
      },
    };

    await runSync('job-1', client, mockNotify);

    // No cursor — filter should be undefined or not contain lastModifiedDateTime
    const filter: string | undefined = capturedOpts.filter;
    const hasLmdFilter = filter ? filter.includes('lastModifiedDateTime') : false;
    expect(hasLmdFilter).toBe(false);
  });

  it('includes orderby when cursor is set', async () => {
    jobStore.set('job-1', makeJob({ cursor: '2024-01-15T10:00:00Z' }));

    let capturedOpts: any;
    const client: any = {
      list: async (_entitySet: any, opts: any) => {
        capturedOpts = opts;
        return { value: [] };
      },
    };

    await runSync('job-1', client, mockNotify);

    expect(capturedOpts.orderby).toBe('lastModifiedDateTime asc');
  });

  it('does NOT include orderby when no cursor', async () => {
    jobStore.set('job-1', makeJob({ cursor: null }));

    let capturedOpts: any;
    const client: any = {
      list: async (_entitySet: any, opts: any) => {
        capturedOpts = opts;
        return { value: [] };
      },
    };

    await runSync('job-1', client, mockNotify);

    expect(capturedOpts.orderby).toBeUndefined();
  });

  it('sets cursor to the maximum lastModifiedDateTime from entities', async () => {
    jobStore.set('job-1', makeJob({ cursor: '2024-01-10T00:00:00Z' }));

    const client: any = {
      list: async () => ({
        value: [
          { id: 'po-1', lastModifiedDateTime: '2024-01-15T08:00:00Z' },
          { id: 'po-2', lastModifiedDateTime: '2024-01-20T12:00:00Z' },
          { id: 'po-3', lastModifiedDateTime: '2024-01-18T06:00:00Z' },
        ],
      }),
    };

    await runSync('job-1', client, mockNotify);

    // The idle/success update set should contain cursor = max lastModifiedDateTime
    const successUpdate = updateSets.find(s => s.status === 'idle');
    expect(successUpdate).toBeDefined();
    expect(successUpdate.cursor).toBe('2024-01-20T12:00:00Z');
  });

  it('falls back to existing cursor when entities have no lastModifiedDateTime', async () => {
    jobStore.set('job-1', makeJob({ cursor: '2024-01-10T00:00:00Z' }));

    const client: any = {
      list: async () => ({
        value: [
          { id: 'po-1', number: 'PO001' }, // no lastModifiedDateTime
        ],
      }),
    };

    await runSync('job-1', client, mockNotify);

    const successUpdate = updateSets.find(s => s.status === 'idle');
    expect(successUpdate).toBeDefined();
    expect(successUpdate.cursor).toBe('2024-01-10T00:00:00Z');
  });

  it('falls back to now when no cursor and no entity lastModifiedDateTime (first run, no timestamps)', async () => {
    jobStore.set('job-1', makeJob({ cursor: null }));

    const client: any = {
      list: async () => ({ value: [{ id: 'po-1', number: 'PO001' }] }),
    };

    const before = Date.now();
    await runSync('job-1', client, mockNotify);
    const after = Date.now();

    const successUpdate = updateSets.find(s => s.status === 'idle');
    expect(successUpdate).toBeDefined();
    // cursor should be an ISO string representing "now" (within test window)
    const cursorMs = new Date(successUpdate.cursor).getTime();
    expect(cursorMs).toBeGreaterThanOrEqual(before);
    expect(cursorMs).toBeLessThanOrEqual(after);
  });

  it('selects the MAXIMUM lastModifiedDateTime across multiple entities', async () => {
    jobStore.set('job-1', makeJob({ cursor: null }));

    const client: any = {
      list: async () => ({
        value: [
          { id: 'a', lastModifiedDateTime: '2024-03-01T00:00:00Z' },
          { id: 'b', lastModifiedDateTime: '2024-06-15T23:59:59Z' }, // max
          { id: 'c', lastModifiedDateTime: '2024-04-20T12:00:00Z' },
        ],
      }),
    };

    await runSync('job-1', client, mockNotify);

    const successUpdate = updateSets.find(s => s.status === 'idle');
    expect(successUpdate).toBeDefined();
    expect(successUpdate.cursor).toBe('2024-06-15T23:59:59Z');
  });
});
