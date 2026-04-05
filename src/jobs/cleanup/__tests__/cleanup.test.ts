import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFindStale = mock(() => Promise.resolve([]));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockExpireSessions = mock(() => Promise.resolve(0));
const mockDeleteExpiredKeys = mock(() => Promise.resolve(0));

mock.module('../../../infra/a2a/task-repo', () => ({
  taskRepo: { findStale: mockFindStale, updateStatus: mockUpdateStatus },
}));
mock.module('../../../modules/sessions/sessions.service', () => ({
  sessionsService: { expireIdleSessions: mockExpireSessions },
}));
mock.module('../../../modules/api-keys/api-keys.repo', () => ({
  apiKeysRepo: { deleteExpired: mockDeleteExpiredKeys },
}));
mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { runCleanup } = await import('../index');

describe('cleanup job', () => {
  beforeEach(() => {
    mockFindStale.mockReset();
    mockFindStale.mockResolvedValue([]);
    mockUpdateStatus.mockReset();
    mockExpireSessions.mockReset();
    mockExpireSessions.mockResolvedValue(0);
    mockDeleteExpiredKeys.mockReset();
    mockDeleteExpiredKeys.mockResolvedValue(0);
  });

  it('calls all cleanup steps', async () => {
    await runCleanup();
    expect(mockFindStale).toHaveBeenCalledTimes(2);
    expect(mockExpireSessions).toHaveBeenCalledTimes(1);
    expect(mockDeleteExpiredKeys).toHaveBeenCalledTimes(1);
  });

  it('marks stale working tasks as failed', async () => {
    mockFindStale.mockResolvedValueOnce([
      { id: 't-1', status: { state: 'working' } },
    ]);
    await runCleanup();
    expect(mockUpdateStatus).toHaveBeenCalledWith('t-1', 'failed', undefined, undefined);
  });

  it('continues if one step fails', async () => {
    mockFindStale.mockRejectedValueOnce(new Error('db error'));
    await runCleanup();
    expect(mockExpireSessions).toHaveBeenCalledTimes(1);
    expect(mockDeleteExpiredKeys).toHaveBeenCalledTimes(1);
  });
});
