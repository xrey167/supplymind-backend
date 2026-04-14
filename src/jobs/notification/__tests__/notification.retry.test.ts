import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mocks — all must be declared BEFORE the dynamic import below
// ---------------------------------------------------------------------------

const mockListFailed = mock(() => Promise.resolve([]));
const mockMarkDelivered = mock(() => Promise.resolve(true));
const mockMarkFailed = mock(() => Promise.resolve(true));

// Spread the real module so NotificationsRepository class export is preserved
// for notifications.repo.test.ts when running in the same Bun worker.
const _realRepo = require('../../../modules/notifications/notifications.repo');
mock.module('../../../modules/notifications/notifications.repo', () => ({
  ..._realRepo,
  notificationsRepo: {
    listFailed: mockListFailed,
    markDelivered: mockMarkDelivered,
    markFailed: mockMarkFailed,
  },
}));

const mockDispatchChannel = mock(() => Promise.resolve(true));
// Spread the real module so NotificationsService class, notificationsService singleton,
// and isInQuietHours export are preserved for other notification tests in the same worker.
const _realSvc = require('../../../modules/notifications/notifications.service');
mock.module('../../../modules/notifications/notifications.service', () => ({
  ..._realSvc,
  dispatchChannel: mockDispatchChannel,
}));

mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
}));

// Import AFTER mocks are registered
const { retryFailedNotifications } = await import('../index');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFailedNotif(id: string, channels = ['slack']): any {
  return {
    id,
    workspaceId: 'ws-1',
    metadata: { _channels: channels, _recipientEmail: null },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('retryFailedNotifications', () => {
  beforeEach(() => {
    mockListFailed.mockReset();
    mockMarkDelivered.mockReset();
    mockMarkFailed.mockReset();
    mockDispatchChannel.mockReset();

    mockListFailed.mockResolvedValue([]);
    mockMarkDelivered.mockResolvedValue(true);
    mockMarkFailed.mockResolvedValue(true);
    mockDispatchChannel.mockResolvedValue(true);
  });

  it('returns 0 when no failed notifications', async () => {
    mockListFailed.mockResolvedValueOnce([]);

    const retried = await retryFailedNotifications();

    expect(retried).toBe(0);
    expect(mockListFailed).toHaveBeenCalledWith(50);
    expect(mockMarkDelivered).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it('marks delivered when dispatchChannel returns true', async () => {
    mockListFailed.mockResolvedValueOnce([makeFailedNotif('n-1', ['slack'])]);
    mockDispatchChannel.mockResolvedValueOnce(true);

    const retried = await retryFailedNotifications();

    expect(mockMarkDelivered).toHaveBeenCalledTimes(1);
    expect(mockMarkDelivered).toHaveBeenCalledWith('n-1');
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(retried).toBe(1);
  });

  it('marks failed when dispatchChannel throws', async () => {
    mockListFailed.mockResolvedValueOnce([makeFailedNotif('n-2', ['slack'])]);
    mockDispatchChannel.mockRejectedValueOnce(new Error('network error'));

    const retried = await retryFailedNotifications();

    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledWith('n-2');
    expect(mockMarkDelivered).not.toHaveBeenCalled();
    expect(retried).toBe(1);
  });

  it('marks failed when dispatchChannel returns false (no credentials)', async () => {
    mockListFailed.mockResolvedValueOnce([makeFailedNotif('n-3', ['slack'])]);
    mockDispatchChannel.mockResolvedValueOnce(false);

    const retried = await retryFailedNotifications();

    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledWith('n-3');
    expect(mockMarkDelivered).not.toHaveBeenCalled();
    expect(retried).toBe(1);
  });

  it('skips count for in_app-only notifications', async () => {
    mockListFailed.mockResolvedValueOnce([makeFailedNotif('n-4', ['in_app'])]);

    const retried = await retryFailedNotifications();

    // in_app is filtered out of outbound → outbound.length === 0 → markDelivered
    expect(mockDispatchChannel).not.toHaveBeenCalled();
    expect(mockMarkDelivered).toHaveBeenCalledTimes(1);
    expect(mockMarkDelivered).toHaveBeenCalledWith('n-4');
    // outbound.length === 0 → retried not incremented
    expect(retried).toBe(0);
  });

  it('processes multiple notifications independently', async () => {
    mockListFailed.mockResolvedValueOnce([
      makeFailedNotif('n-5', ['slack']),
      makeFailedNotif('n-6', ['slack']),
    ]);
    // First dispatch → true, second dispatch → false
    mockDispatchChannel
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const retried = await retryFailedNotifications();

    expect(mockMarkDelivered).toHaveBeenCalledTimes(1);
    expect(mockMarkDelivered).toHaveBeenCalledWith('n-5');
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledWith('n-6');
    expect(retried).toBe(2);
  });
});
