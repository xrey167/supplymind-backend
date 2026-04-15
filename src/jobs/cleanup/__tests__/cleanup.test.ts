import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

// Use DI — no mock.module needed for taskRepo.
const mockFindStale = mock(() => Promise.resolve([] as any[]));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockTaskRepo = { findStale: mockFindStale, updateStatus: mockUpdateStatus } as any;
const mockDeleteExpiredKeys = mock(() => Promise.resolve(0));
const _realApiKeysRepo = require('../../../modules/api-keys/api-keys.repo');
mock.module('../../../modules/api-keys/api-keys.repo', () => ({
  ..._realApiKeysRepo,
  apiKeysRepo: { ..._realApiKeysRepo.apiKeysRepo, deleteExpired: mockDeleteExpiredKeys },
}));
const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

import { runCleanup } from '../index';
const wrappedRunCleanup = () => runCleanup(mockTaskRepo);
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
    await wrappedRunCleanup();
    expect(mockFindStale).toHaveBeenCalledTimes(2);
    expect(expireIdleSessionsSpy).toHaveBeenCalledTimes(1);
    expect(mockDeleteExpiredKeys).toHaveBeenCalledTimes(1);
  });

  it('marks stale working tasks as failed', async () => {
    mockFindStale.mockResolvedValueOnce([
      { id: 't-1', status: { state: 'working' } },
    ]);
    await wrappedRunCleanup();
    expect(mockUpdateStatus).toHaveBeenCalledWith('t-1', 'failed', undefined, undefined);
  });

  it('continues if one step fails', async () => {
    mockFindStale.mockRejectedValueOnce(new Error('db error'));
    await wrappedRunCleanup();
    expect(expireIdleSessionsSpy).toHaveBeenCalledTimes(1);
    expect(mockDeleteExpiredKeys).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => mock.restore());
