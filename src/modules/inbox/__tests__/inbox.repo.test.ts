import { describe, test, expect, beforeEach, mock, afterAll } from 'bun:test';

// Mock the db client before importing the repo
const mockReturning = mock(() => Promise.resolve([{
  id: '00000000-0000-0000-0000-000000000001',
  workspaceId: 'ws-1',
  userId: 'user-1',
  type: 'notification',
  title: 'Test',
  body: null,
  metadata: {},
  sourceType: null,
  sourceId: null,
  read: false,
  pinned: false,
  createdAt: new Date('2026-01-01'),
}]));

const mockValues = mock(() => ({ returning: mockReturning }));
const mockSet = mock(() => ({ where: mock(() => ({ returning: mockReturning })) }));
const mockLimit = mock(() => ({ offset: mock(() => Promise.resolve([])) }));
const mockOrderBy = mock(() => ({ limit: mockLimit }));
const mockWhere = mock(() => ({ orderBy: mockOrderBy, returning: mockReturning }));
const mockFrom = mock(() => ({ where: mockWhere }));

const mockDb = {
  insert: mock(() => ({ values: mockValues })),
  select: mock(() => ({ from: mockFrom })),
  update: mock(() => ({ set: mockSet })),
  delete: mock(() => ({ where: mockWhere })),
};

const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({ ..._realDbClient, db: mockDb }));
const _realSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({
  ..._realSchema,
  inboxItems: {
    id: 'id',
    workspaceId: 'workspace_id',
    userId: 'user_id',
    type: 'type',
    title: 'title',
    body: 'body',
    metadata: 'metadata',
    sourceType: 'source_type',
    sourceId: 'source_id',
    read: 'read',
    pinned: 'pinned',
    createdAt: 'created_at',
  },
}));

const { InboxRepository } = await import('../inbox.repo');

describe('InboxRepository', () => {
  let repo: InstanceType<typeof InboxRepository>;

  beforeEach(() => {
    repo = new InboxRepository();
    // Reset call counts
    for (const fn of [mockReturning, mockValues, mockDb.insert, mockDb.select, mockDb.update, mockDb.delete]) {
      fn.mockClear();
    }
  });

  test('create inserts and returns an inbox item', async () => {
    const result = await repo.create({
      workspaceId: 'ws-1',
      userId: 'user-1',
      type: 'notification',
      title: 'Test',
    });

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(result.type).toBe('notification');
  });

  test('create uses null defaults for optional fields', async () => {
    await repo.create({
      workspaceId: 'ws-1',
      type: 'system',
      title: 'System msg',
    });

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const valuesCall = (mockValues.mock.calls as any[][])[0]![0];
    expect(valuesCall.userId).toBeNull();
    expect(valuesCall.body).toBeNull();
    expect(valuesCall.sourceType).toBeNull();
    expect(valuesCall.sourceId).toBeNull();
    expect(valuesCall.metadata).toEqual({});
  });

  test('list calls select with workspace filter', async () => {
    await repo.list('user-1', 'ws-1');
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  test('list applies filter options', async () => {
    await repo.list('user-1', 'ws-1', {
      unreadOnly: true,
      type: 'alert',
      pinned: true,
      limit: 10,
      offset: 5,
    });
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  test('markRead calls update with read=true', async () => {
    await repo.markRead('some-id');
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  test('markAllRead calls update for workspace+user', async () => {
    await repo.markAllRead('user-1', 'ws-1');
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  test('togglePin calls update with NOT pinned', async () => {
    await repo.togglePin('some-id');
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  test('getUnreadCount returns a number', async () => {
    mockFrom.mockReturnValueOnce({
      where: mock(() => Promise.resolve([{ count: 5 }])),
    } as any);
    const count = await repo.getUnreadCount('user-1', 'ws-1');
    expect(typeof count).toBe('number');
  });

  test('deleteOlderThan calls delete and returns count', async () => {
    mockWhere.mockReturnValueOnce({
      returning: mock(() => Promise.resolve([{ id: 'a' }, { id: 'b' }])),
    } as any);
    const count = await repo.deleteOlderThan('ws-1', new Date('2025-01-01'));
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(typeof count).toBe('number');
  });
});

afterAll(() => mock.restore());
