import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNotify = mock(() => Promise.resolve({ id: 'notif-1' }));

mock.module('../notifications.service', () => ({
  notificationsService: {
    notify: mockNotify,
  },
}));

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


const { initNotificationHandler } = await import('../../../events/consumers/notification.handler');

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
