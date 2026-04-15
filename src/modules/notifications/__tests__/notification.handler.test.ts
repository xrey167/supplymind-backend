import { describe, test, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

// Mock only the leaf deps that notifications.service.ts transitively needs.
// We do NOT replace notifications.repo itself — that would break notifications.repo.test.ts
// (which runs after this file alphabetically and imports NotificationsRepository from the same module).
// Instead we stub the modules notifications.repo USES, so it's importable without a real DB.
// Build a db mock rich enough for both this test and notifications.repo.test.ts
// (which shares the same mock.module since it runs in the same Bun worker).
const _mockWhere = mock(() => ({ returning: mock(() => Promise.resolve([{ id: 'notif-1' }])) }));
const _mockFrom = mock(() => ({
  where: _mockWhere,
  orderBy: mock(() => ({ limit: mock(() => ({ offset: mock(() => Promise.resolve([])) })) })),
}));
const _mockValues = mock(() => ({
  returning: mock(() => Promise.resolve([{
    id: 'notif-1', workspaceId: 'ws-1', type: 'task_error', title: 'Test', status: 'pending',
  }])),
}));
const _mockSet = mock(() => ({ where: _mockWhere }));
const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    select: () => ({ from: _mockFrom }),
    insert: () => ({ values: _mockValues }),
    update: () => ({ set: _mockSet }),
  },
}));
const _realSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({
  ..._realSchema,
  notifications: {
    id: 'id', workspaceId: 'workspace_id', userId: 'user_id',
    type: 'type', readAt: 'read_at', createdAt: 'created_at', status: 'status',
  },
  notificationPreferences: {},
}));
const _realDrizzle = require('drizzle-orm');
mock.module('drizzle-orm', () => ({
  ..._realDrizzle,
  eq: mock(() => {}),
  and: mock(() => {}),
  isNull: mock(() => {}),
  desc: mock(() => {}),
  sql: mock(() => {}),
}));
mock.module('../preferences/notification-preferences.repo', () => ({ notificationPreferencesRepo: { get: mock(async () => null), set: mock(async () => {}), delete: mock(async () => {}) } }));
mock.module('../../../infra/realtime/ws-server', () => ({ wsServer: { broadcastToSubscribed: mock(() => {}) } }));

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: new Proxy(_realLogger.logger, {
    get(target: any, prop: string | symbol) {
      if (prop === 'info') return () => {};
      if (prop === 'debug') return () => {};
      if (prop === 'warn') return () => {};
      if (prop === 'error') return () => {};
      return target[prop];
    },
  }),
}));

// Capture subscriptions
const subscriptions: Array<{ pattern: string; handler: (event: any) => Promise<void> }> = [];

// Include publish so downstream tests that import eventBus from the real module
// and call eventBus.publish still work (they get the real module, not this mock).
const _realBus = require('../../../events/bus');
const _origHandlerPublish = _realBus.eventBus.publish.bind(_realBus.eventBus);
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: string | symbol) {
      if (prop === 'subscribe') return (...args: any[]) => {
        const [pattern, handler] = args;
        subscriptions.push({ pattern, handler });
        return target.subscribe(...args);
      };
      if (prop === 'publish') return (...args: any[]) => _origHandlerPublish(...args);
      return target[prop];
    },
  }),
}));

const { notificationsService } = await import('../notifications.service');
const mockNotify = spyOn(notificationsService, 'notify').mockResolvedValue({ id: 'notif-1' } as any);

const { initNotificationHandler } = await import('../../../events/consumers/notification.handler');

afterAll(() => { mockNotify.mockRestore(); });

describe('notification.handler', () => {
  beforeEach(() => {
    subscriptions.length = 0;
    mockNotify.mockClear();
    initNotificationHandler();
  });

  test('subscribes to 4 topics', () => {
    expect(subscriptions.length).toBe(4);
  });

  test('TASK_ERROR triggers notify with task_error type', async () => {
    const handler = subscriptions.find(s => s.pattern === 'task.error')!.handler;
    await handler({ data: { taskId: 'task-1', workspaceId: 'ws-1', error: 'boom' } });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0] as any;
    expect(call.type).toBe('task_error');
    expect(call.workspaceId).toBe('ws-1');
  });

  test('BUDGET_WARNING triggers notify with budget_warning type', async () => {
    const handler = subscriptions.find(s => s.pattern === 'billing.budget_warning')!.handler;
    await handler({ data: { workspaceId: 'ws-1' } });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0] as any;
    expect(call.type).toBe('budget_warning');
  });

  test('BUDGET_EXCEEDED triggers notify with budget_exceeded type', async () => {
    const handler = subscriptions.find(s => s.pattern === 'billing.budget_exceeded')!.handler;
    await handler({ data: { workspaceId: 'ws-1' } });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0] as any;
    expect(call.type).toBe('budget_exceeded');
  });

  test('MEMBER_JOINED triggers notify with member_joined type', async () => {
    const handler = subscriptions.find(s => s.pattern === 'member.joined')!.handler;
    await handler({ data: { workspaceId: 'ws-1', userId: 'user-1', memberName: 'Alice' } });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0] as any;
    expect(call.type).toBe('member_joined');
    expect(call.body).toContain('Alice');
  });
});

afterAll(() => mock.restore());
