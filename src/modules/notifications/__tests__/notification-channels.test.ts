import { describe, test, expect, mock, afterAll, beforeEach, setSystemTime } from 'bun:test';
import type { CreateNotificationInput, Notification } from '../notifications.types';

// --- Mock all direct deps ---

const mockCreate = mock(() => Promise.resolve(null as any));
const mockMarkDelivered = mock(() => Promise.resolve(true));
const mockMarkFailed = mock(() => Promise.resolve(true));
const _realRepo = require('../notifications.repo');
mock.module('../notifications.repo', () => ({
  ..._realRepo,
  notificationsRepo: {
    createNotification: mockCreate,
    list: mock(() => Promise.resolve([])),
    markRead: mock(() => Promise.resolve(null as any)),
    markAllRead: mock(() => Promise.resolve()),
    getUnreadCount: mock(() => Promise.resolve(0)),
    markDelivered: mockMarkDelivered,
    markFailed: mockMarkFailed,
  },
}));

const mockPrefGet = mock(() => Promise.resolve(null as any));
const mockPrefGetGlobal = mock(() => Promise.resolve(null as any));
const _realPrefRepo = require('../preferences/notification-preferences.repo');
mock.module('../preferences/notification-preferences.repo', () => ({
  ..._realPrefRepo,
  notificationPreferencesRepo: { get: mockPrefGet, getGlobal: mockPrefGetGlobal },
}));

const mockDeliverInApp = mock(() => Promise.resolve());
const _realInApp = require('../channels/in-app/in-app.channel');
mock.module('../channels/in-app/in-app.channel', () => ({ ..._realInApp, deliverInApp: mockDeliverInApp }));

const mockDeliverWebSocket = mock(() => Promise.resolve());
const _realWsCh = require('../channels/websocket/websocket.channel');
mock.module('../channels/websocket/websocket.channel', () => ({ ..._realWsCh, deliverWebSocket: mockDeliverWebSocket }));

const mockDeliverEmail = mock(() => Promise.resolve());
const _realEmailCh = require('../channels/email/email.channel');
mock.module('../channels/email/email.channel', () => ({ ..._realEmailCh, deliverEmail: mockDeliverEmail }));

const mockDeliverSlack = mock(() => Promise.resolve());
const _realSlackCh = require('../channels/slack/slack.channel');
mock.module('../channels/slack/slack.channel', () => ({ ..._realSlackCh, deliverSlack: mockDeliverSlack }));

const mockDeliverTelegram = mock(() => Promise.resolve());
const _realTelegramCh = require('../channels/telegram/telegram.channel');
mock.module('../channels/telegram/telegram.channel', () => ({ ..._realTelegramCh, deliverTelegram: mockDeliverTelegram }));

const mockGetByProvider = mock(() => Promise.resolve(null as any));
const _realCredService = require('../../credentials/credentials.service');
mock.module('../../credentials/credentials.service', () => ({
  ..._realCredService,
  credentialsService: { getByProvider: mockGetByProvider },
}));

const _realBus = require('../../../events/bus');
const _origPublish = _realBus.eventBus.publish.bind(_realBus.eventBus);
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: string | symbol) {
      if (prop === 'publish') return (...args: any[]) => _origPublish(...args);
      return target[prop];
    },
  }),
}));

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: new Proxy(_realLogger.logger, {
    get(target: any, prop: string | symbol) {
      if (['info', 'debug', 'warn', 'error'].includes(prop as string)) return () => {};
      return target[prop];
    },
  }),
}));

const { NotificationsService } = await import('../notifications.service?fresh=1' as string);

const fakeNotif: Notification = {
  id: 'n1', workspaceId: 'ws-1', userId: 'u1', type: 'alert_fired',
  title: 'Alert', body: 'Details', metadata: {}, channel: 'in_app',
  status: 'pending', readAt: null, createdAt: new Date(),
};

describe('NotificationsService – outbound channels', () => {
  let service: InstanceType<typeof NotificationsService>;

  beforeEach(() => {
    service = new NotificationsService();
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeNotif);
    mockPrefGet.mockClear();
    mockPrefGet.mockResolvedValue(null);
    mockPrefGetGlobal.mockClear();
    mockPrefGetGlobal.mockResolvedValue(null);
    mockGetByProvider.mockClear();
    mockGetByProvider.mockResolvedValue(null);
    mockMarkDelivered.mockClear();
    mockMarkFailed.mockClear();
    mockDeliverInApp.mockClear();
    mockDeliverEmail.mockClear();
    mockDeliverSlack.mockClear();
    mockDeliverTelegram.mockClear();
    mockDeliverWebSocket.mockClear();
  });

  const base: CreateNotificationInput = {
    workspaceId: 'ws-1', userId: 'u1', type: 'alert_fired', title: 'Alert',
  };

  test('email channel: calls deliverEmail when recipientEmail provided', async () => {
    mockPrefGet.mockResolvedValue({ muted: false, channels: ['in_app', 'email'], quietHours: null });
    await service.notify({ ...base, recipientEmail: 'user@example.com' });
    expect(mockDeliverEmail).toHaveBeenCalledWith(fakeNotif, 'user@example.com');
  });

  test('email channel: skips deliverEmail when recipientEmail absent', async () => {
    mockPrefGet.mockResolvedValue({ muted: false, channels: ['in_app', 'email'], quietHours: null });
    await service.notify(base);
    expect(mockDeliverEmail).not.toHaveBeenCalled();
  });

  test('slack channel: calls deliverSlack with webhookUrl from credential', async () => {
    mockPrefGet.mockResolvedValue({ muted: false, channels: ['in_app', 'slack'], quietHours: null });
    mockGetByProvider.mockResolvedValue({ value: 'https://hooks.slack.com/abc', metadata: {} });
    await service.notify(base);
    expect(mockGetByProvider).toHaveBeenCalledWith('ws-1', 'slack');
    expect(mockDeliverSlack).toHaveBeenCalledWith(fakeNotif, 'https://hooks.slack.com/abc');
  });

  test('slack channel: skips when no slack credential', async () => {
    mockPrefGet.mockResolvedValue({ muted: false, channels: ['in_app', 'slack'], quietHours: null });
    mockGetByProvider.mockResolvedValue(null);
    await service.notify(base);
    expect(mockDeliverSlack).not.toHaveBeenCalled();
  });

  test('telegram channel: calls deliverTelegram with botToken and chatId', async () => {
    mockPrefGet.mockResolvedValue({ muted: false, channels: ['in_app', 'telegram'], quietHours: null });
    mockGetByProvider.mockResolvedValue({ value: 'bot123', metadata: { chatId: '9876' } });
    await service.notify(base);
    expect(mockGetByProvider).toHaveBeenCalledWith('ws-1', 'telegram');
    expect(mockDeliverTelegram).toHaveBeenCalledWith(fakeNotif, 'bot123', '9876');
  });

  test('telegram channel: skips when no chatId in credential metadata', async () => {
    mockPrefGet.mockResolvedValue({ muted: false, channels: ['in_app', 'telegram'], quietHours: null });
    mockGetByProvider.mockResolvedValue({ value: 'bot123', metadata: {} });
    await service.notify(base);
    expect(mockDeliverTelegram).not.toHaveBeenCalled();
  });

  test('quiet hours: skips all outbound channels when in quiet window', async () => {
    // Freeze time at noon UTC — unambiguously inside 00:00–23:59.
    // isInQuietHours uses strict `cur < end`, so 23:59 would be outside the window.
    setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    mockPrefGet.mockResolvedValue({
      muted: false,
      channels: ['in_app', 'websocket', 'slack'],
      quietHours: { start: '00:00', end: '23:59', tz: 'UTC' },
    });
    mockGetByProvider.mockResolvedValue({ value: 'https://slack.hook', metadata: {} });
    await service.notify(base);
    expect(mockDeliverInApp).toHaveBeenCalledTimes(1);
    expect(mockDeliverWebSocket).not.toHaveBeenCalled();
    expect(mockDeliverSlack).not.toHaveBeenCalled();
    setSystemTime(); // restore real clock
  });

  test('global pref muted: returns null', async () => {
    mockPrefGetGlobal.mockResolvedValue({ muted: true, channels: ['in_app'], quietHours: null });
    const result = await service.notify(base);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('type-specific pref muted: returns null', async () => {
    mockPrefGet.mockResolvedValue({ muted: true, channels: ['in_app'], quietHours: null });
    const result = await service.notify(base);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
