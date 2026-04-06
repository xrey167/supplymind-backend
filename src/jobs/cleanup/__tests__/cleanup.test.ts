import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

const mockFindStale = mock(() => Promise.resolve([]));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockDeleteExpiredKeys = mock(() => Promise.resolve(0));

mock.module('../../../infra/a2a/task-repo', () => ({
  taskRepo: { findStale: mockFindStale, updateStatus: mockUpdateStatus },
}));
mock.module('../../../modules/api-keys/api-keys.repo', () => ({
  apiKeysRepo: { deleteExpired: mockDeleteExpiredKeys },
}));
mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { runCleanup } = await import('../index');
import { sessionsService } from '../../../modules/sessions/sessions.service';

// Use spyOn to avoid polluting sessions.service module cache for downstream tests
const expireIdleSessionsSpy = spyOn(sessionsService, 'expireIdleSessions').mockResolvedValue(0 as any);

afterAll(() => {
  expireIdleSessionsSpy.mockRestore();
});

describe('cleanup job', () => {
  beforeEach(() => {
    mockFindStale.mockReset();
    mockFindStale.mockResolvedValue([]);
    mockUpdateStatus.mockReset();
    expireIdleSessionsSpy.mockReset();
    expireIdleSessionsSpy.mockResolvedValue(0 as any);
    mockDeleteExpiredKeys.mockReset();
    mockDeleteExpiredKeys.mockResolvedValue(0);
  });

  it('calls all cleanup steps', async () => {
    await runCleanup();
    expect(mockFindStale).toHaveBeenCalledTimes(2);
    expect(expireIdleSessionsSpy).toHaveBeenCalledTimes(1);
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
    expect(expireIdleSessionsSpy).toHaveBeenCalledTimes(1);
    expect(mockDeleteExpiredKeys).toHaveBeenCalledTimes(1);
  });
});
