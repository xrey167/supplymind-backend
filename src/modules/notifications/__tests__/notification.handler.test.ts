import { describe, test, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

// Mock only the leaf deps that notifications.service.ts transitively needs.
// We do NOT replace notifications.repo itself — that would break notifications.repo.test.ts
// (which runs after this file alphabetically and imports NotificationsRepository from the same module).
// Instead we stub the modules notifications.repo USES, so it's importable without a real DB.
mock.module('../../../infra/db/client', () => ({ db: { select: () => ({}), insert: () => ({}), update: () => ({}) } }));
mock.module('../../../infra/db/schema', () => ({ notifications: {}, notificationPreferences: {} }));
mock.module('drizzle-orm', () => ({ eq: () => {}, and: () => {}, isNull: () => {}, desc: () => {}, sql: () => {} }));
mock.module('../preferences/notification-preferences.repo', () => ({ notificationPreferencesRepo: { get: mock(async () => null), set: mock(async () => {}), delete: mock(async () => {}) } }));
mock.module('../../../infra/realtime/ws-server', () => ({ wsServer: { broadcastToSubscribed: mock(() => {}) } }));

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
}));

// Capture subscriptions
const subscriptions: Array<{ pattern: string; handler: (event: any) => Promise<void> }> = [];

// Include publish so downstream tests that import eventBus from the real module
// and call eventBus.publish still work (they get the real module, not this mock).
mock.module('../../../events/bus', () => ({
  eventBus: {
    subscribe: mock((pattern: string, handler: any) => {
      subscriptions.push({ pattern, handler });
      return 'sub-id';
    }),
    publish: mock(() => Promise.resolve()),
    unsubscribe: mock(() => {}),
  },
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
