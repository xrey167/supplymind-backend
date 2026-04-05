import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRefreshAll = mock(() => Promise.resolve({ refreshed: 2, failed: 0 }));
mock.module('../../../modules/agent-registry/agent-registry.service', () => ({
  agentRegistryService: { refreshAll: mockRefreshAll },
}));
mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { runSync } = await import('../index');

describe('sync job', () => {
  beforeEach(() => {
    mockRefreshAll.mockReset();
    mockRefreshAll.mockResolvedValue({ refreshed: 2, failed: 0 });
  });

  it('calls agentRegistryService.refreshAll', async () => {
    await runSync();
    expect(mockRefreshAll).toHaveBeenCalledTimes(1);
  });

  it('does not throw when refreshAll fails', async () => {
    mockRefreshAll.mockRejectedValue(new Error('network error'));
    await expect(runSync()).resolves.toBeUndefined();
  });
});
