import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { CreateNotificationInput, Notification } from '../notifications.types';

// --- Mock all transitive deps that fail in test context ---

mock.module('../../../infra/db/client', () => ({ db: {} }));
mock.module('../../../infra/db/schema', () => ({ notifications: {}, notificationPreferences: {} }));
mock.module('../../../infra/realtime/ws-server', () => ({
  wsServer: { broadcastToSubscribed: mock(() => {}) },
}));
mock.module('drizzle-orm', () => ({
  eq: mock(() => {}),
  and: mock(() => {}),
  isNull: mock(() => {}),
  desc: mock(() => {}),
  sql: mock(() => {}),
}));

// --- Mock direct deps of the service ---

// fakeNotification is defined below; mock factories return it lazily via beforeEach mockResolvedValue
const mockCreate = mock(() => Promise.resolve(null as any));
const mockList = mock(() => Promise.resolve([]));
const mockMarkRead = mock(() => Promise.resolve(null as any));
const mockMarkAllRead = mock(() => Promise.resolve());
const mockGetUnreadCount = mock(() => Promise.resolve(5));

mock.module('../notifications.repo', () => ({
  notificationsRepo: {
    create: mockCreate,
    list: mockList,
    markRead: mockMarkRead,
    markAllRead: mockMarkAllRead,
    getUnreadCount: mockGetUnreadCount,
  },
}));

const mockPrefGet = mock(() => Promise.resolve(null));

mock.module('../preferences/notification-preferences.repo', () => ({
  notificationPreferencesRepo: {
    get: mockPrefGet,
  },
}));

const mockDeliverInApp = mock(() => Promise.resolve());
mock.module('../channels/in-app/in-app.channel', () => ({
  deliverInApp: mockDeliverInApp,
}));

const mockDeliverWebSocket = mock(() => Promise.resolve());
mock.module('../channels/websocket/websocket.channel', () => ({
  deliverWebSocket: mockDeliverWebSocket,
}));

const mockPublish = mock(() =>
  Promise.resolve({ id: 'evt-1', topic: '', data: null, source: '', timestamp: '' }),
);
mock.module('../../../events/bus', () => ({
  eventBus: { publish: mockPublish, subscribe: () => 'sub-mock', unsubscribe: () => {} },
}));

mock.module('../../../config/logger', () => ({
  logger: {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  },
}));

// --- Import the actual service AFTER mocks are set up ---

const { NotificationsService } = await import('../notifications.service');

const fakeNotification: Notification = {
  id: 'notif-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  type: 'task_error',
  title: 'Test',
  body: null,
  metadata: {},
  channel: 'in_app',
  status: 'pending',
  readAt: null,
  createdAt: new Date(),
};

describe('NotificationsService', () => {
  let service: InstanceType<typeof NotificationsService>;

  beforeEach(() => {
    service = new NotificationsService();
    mockCreate.mockClear();
    mockList.mockClear();
    mockMarkRead.mockClear();
    mockMarkAllRead.mockClear();
    mockGetUnreadCount.mockClear();
    mockPrefGet.mockClear();
    mockDeliverInApp.mockClear();
    mockDeliverWebSocket.mockClear();
    mockPublish.mockClear();

    // Defaults
    mockPrefGet.mockResolvedValue(null);
    mockCreate.mockResolvedValue(fakeNotification);
  });

  const baseInput: CreateNotificationInput = {
    workspaceId: 'ws-1',
    userId: 'user-1',
    type: 'task_error',
    title: 'Test',
  };

  test('notify() creates notification when not muted', async () => {
    const result = await service.notify(baseInput);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('notif-1');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(baseInput, 'in_app');
    expect(mockDeliverInApp).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  test('notify() returns null when muted', async () => {
    mockPrefGet.mockResolvedValueOnce({ muted: true, channels: ['in_app'] });

    const result = await service.notify(baseInput);

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('notify() dispatches to websocket when preference includes it', async () => {
    mockPrefGet.mockResolvedValueOnce({ muted: false, channels: ['in_app', 'websocket'] });

    const result = await service.notify(baseInput);

    expect(result).not.toBeNull();
    expect(mockDeliverWebSocket).toHaveBeenCalledTimes(1);
    expect(mockDeliverInApp).toHaveBeenCalledTimes(1);
  });

  test('list() delegates to repo', async () => {
    const filter = { limit: 10 };
    await service.list('user-1', 'ws-1', filter as any);

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith('user-1', 'ws-1', filter);
  });

  test('markRead() delegates to repo', async () => {
    await service.markRead('notif-1');

    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    expect(mockMarkRead).toHaveBeenCalledWith('notif-1');
  });

  test('markAllRead() delegates to repo', async () => {
    await service.markAllRead('user-1', 'ws-1');

    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    expect(mockMarkAllRead).toHaveBeenCalledWith('user-1', 'ws-1');
  });

  test('getUnreadCount() delegates to repo', async () => {
    const count = await service.getUnreadCount('user-1', 'ws-1');

    expect(count).toBe(5);
    expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);
    expect(mockGetUnreadCount).toHaveBeenCalledWith('user-1', 'ws-1');
  });
});
