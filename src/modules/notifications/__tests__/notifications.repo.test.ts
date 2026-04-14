import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the DB client
const mockSelect = mock();
const mockInsert = mock();
const mockUpdate = mock();

const mockFrom = mock(() => ({ where: mockWhere, orderBy: mock(() => ({ limit: mock(() => ({ offset: mock(() => Promise.resolve([])) })) })) }));
const mockWhere = mock(() => ({ returning: mock(() => Promise.resolve([{ id: 'notif-1' }])) }));
const mockValues = mock(() => ({ returning: mock(() => Promise.resolve([{ id: 'notif-1', workspaceId: 'ws-1', type: 'task_error', title: 'Test', status: 'pending' }])) }));
const mockSet = mock(() => ({ where: mockWhere }));

// spread to preserve pool and other exports for tests that run after this file
const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: mockValues }),
    update: () => ({ set: mockSet }),
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

const { NotificationsRepository } = await import('../notifications.repo');

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
