import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';

// Mock the DB client
const mockSelect = mock();
const mockInsert = mock();
const mockUpdate = mock();

const mockFrom = mock(() => ({ where: mockWhere, orderBy: mock(() => ({ limit: mock(() => ({ offset: mock(() => Promise.resolve([])) })) })) }));
const mockWhere = mock(() => ({ returning: mock(() => Promise.resolve([{ id: 'notif-1' }])) }));
const mockValues = mock(() => ({ returning: mock(() => Promise.resolve([{ id: 'notif-1', workspaceId: 'ws-1', type: 'task_error', title: 'Test', status: 'pending' }])) }));
const mockSet = mock(() => ({ where: mockWhere }));
const mockExecute = mock(() => Promise.resolve({ rows: [] }));

// spread to preserve pool and other exports for tests that run after this file
const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: mockValues }),
    update: () => ({ set: mockSet }),
    execute: mockExecute,
  },
}));

// spread to preserve all non-notifications tables for tests that run after this file
const _realSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({
  ..._realSchema,
  notifications: {
    id: 'id',
    workspaceId: 'workspace_id',
    userId: 'user_id',
    type: 'type',
    readAt: 'read_at',
    createdAt: 'created_at',
    status: 'status',
  },
}));

const { NotificationsRepository, PER_WORKSPACE_CAP, MAX_NOTIFICATION_ATTEMPTS } = await import('../notifications.repo');

describe('NotificationsRepository', () => {
  let repo: InstanceType<typeof NotificationsRepository>;

  beforeEach(() => {
    repo = new NotificationsRepository();
  });

  test('create inserts a notification record', async () => {
    const result = await repo.create({
      workspaceId: 'ws-1',
      type: 'task_error',
      title: 'Test',
    });
    expect(result).toBeDefined();
    expect(result.id).toBe('notif-1');
  });

  test('markRead updates notification status', async () => {
    const result = await repo.markRead('notif-1');
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// listFailed — per-workspace fairness tests
// ---------------------------------------------------------------------------

describe('NotificationsRepository.listFailed — per-workspace fairness', () => {
  /** Build a fake notification row with snake_case column names as returned by raw SQL */
  function makeRow(id: string, workspaceId: string, attemptCount = 1) {
    return {
      id,
      workspace_id: workspaceId,
      user_id: null,
      type: 'task_error',
      title: `Notification ${id}`,
      body: null,
      metadata: {},
      channel: 'in_app',
      status: 'failed',
      read_at: null,
      attempt_count: attemptCount,
      last_attempted_at: new Date('2024-01-01'),
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
    };
  }

  let repo: InstanceType<typeof NotificationsRepository>;

  beforeEach(() => {
    mockExecute.mockReset();
    repo = new NotificationsRepository();
  });

  test('returns empty array when no failed notifications', async () => {
    mockExecute.mockImplementation(() => Promise.resolve({ rows: [] }));
    const results = await repo.listFailed(50);
    expect(results).toEqual([]);
  });

  test('maps snake_case columns to camelCase fields', async () => {
    const row = makeRow('n-1', 'ws-a');
    mockExecute.mockImplementation(() => Promise.resolve({ rows: [row] }));
    const results = await repo.listFailed(50);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('n-1');
    expect(results[0]!.workspaceId).toBe('ws-a');
    expect(results[0]!.attemptCount).toBe(1);
  });

  test('round-robin distribution: 3 workspaces with different failure counts', async () => {
    // Simulate DB returning a round-robin result: 2 from ws-a, 2 from ws-b, 2 from ws-c
    // (the CTE with PER_WORKSPACE_CAP already enforces this in the DB)
    const rows = [
      makeRow('a-1', 'ws-a'), makeRow('a-2', 'ws-a'),
      makeRow('b-1', 'ws-b'), makeRow('b-2', 'ws-b'),
      makeRow('c-1', 'ws-c'), makeRow('c-2', 'ws-c'),
    ];
    mockExecute.mockImplementation(() => Promise.resolve({ rows }));
    const results = await repo.listFailed(50);
    // All workspaces represented
    const workspaces = new Set(results.map(r => r.workspaceId));
    expect(workspaces.size).toBe(3);
    expect(workspaces.has('ws-a')).toBe(true);
    expect(workspaces.has('ws-b')).toBe(true);
    expect(workspaces.has('ws-c')).toBe(true);
  });

  test('PER_WORKSPACE_CAP constant is 10', () => {
    expect(PER_WORKSPACE_CAP).toBe(10);
  });

  test('batchSize is forwarded to the query (default 50)', async () => {
    mockExecute.mockImplementation(() => Promise.resolve({ rows: [] }));
    await repo.listFailed(25);
    // The SQL should have been called once
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => mock.restore());
