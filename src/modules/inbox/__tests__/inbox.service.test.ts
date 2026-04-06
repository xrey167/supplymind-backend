import { describe, test, expect, beforeEach, mock } from 'bun:test';

const mockRepo = {
  create: mock(() => Promise.resolve({
    id: 'item-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    type: 'notification',
    title: 'Hello',
    body: null,
    metadata: {},
    sourceType: null,
    sourceId: null,
    read: false,
    pinned: false,
    createdAt: new Date(),
  })),
  list: mock(() => Promise.resolve([])),
  markRead: mock(() => Promise.resolve({ id: 'item-1', read: true })),
  markAllRead: mock(() => Promise.resolve()),
  togglePin: mock(() => Promise.resolve({ id: 'item-1', pinned: true })),
  getUnreadCount: mock(() => Promise.resolve(3)),
  deleteOlderThan: mock(() => Promise.resolve(5)),
};

mock.module('../inbox.repo', () => ({
  inboxRepo: mockRepo,
  InboxRepository: class {},
}));

const { InboxService } = await import('../inbox.service');

describe('InboxService', () => {
  let service: InstanceType<typeof InboxService>;

  beforeEach(() => {
    service = new InboxService();
    for (const fn of Object.values(mockRepo)) {
      fn.mockClear();
    }
  });

  test('add delegates to repo.create', async () => {
    const result = await service.add({
      workspaceId: 'ws-1',
      userId: 'user-1',
      type: 'notification',
      title: 'Hello',
    });
    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('item-1');
  });

  test('list delegates to repo.list', async () => {
    await service.list('user-1', 'ws-1', { unreadOnly: true });
    expect(mockRepo.list).toHaveBeenCalledTimes(1);
    expect(mockRepo.list.mock.calls[0]).toEqual(['user-1', 'ws-1', { unreadOnly: true }]);
  });

  test('markRead delegates to repo.markRead', async () => {
    const result = await service.markRead('item-1');
    expect(mockRepo.markRead).toHaveBeenCalledWith('item-1');
    expect(result!.read).toBe(true);
  });

  test('markAllRead delegates to repo.markAllRead', async () => {
    await service.markAllRead('user-1', 'ws-1');
    expect(mockRepo.markAllRead).toHaveBeenCalledWith('user-1', 'ws-1');
  });

  test('togglePin delegates to repo.togglePin', async () => {
    const result = await service.togglePin('item-1');
    expect(mockRepo.togglePin).toHaveBeenCalledWith('item-1');
    expect(result!.pinned).toBe(true);
  });

  test('getUnreadCount delegates to repo.getUnreadCount', async () => {
    const count = await service.getUnreadCount('user-1', 'ws-1');
    expect(count).toBe(3);
  });

  test('cleanup calculates cutoff date and delegates to deleteOlderThan', async () => {
    const deleted = await service.cleanup('ws-1', 30);
    expect(mockRepo.deleteOlderThan).toHaveBeenCalledTimes(1);
    const [wsId, cutoffDate] = mockRepo.deleteOlderThan.mock.calls[0]!;
    expect(wsId).toBe('ws-1');
    // Cutoff should be roughly 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const diff = Math.abs((cutoffDate as Date).getTime() - thirtyDaysAgo.getTime());
    expect(diff).toBeLessThan(1000); // within 1 second
    expect(deleted).toBe(5);
  });
});
