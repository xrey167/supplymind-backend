import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { runSync } = await import('../index');
import { agentRegistryService } from '../../../modules/agent-registry/agent-registry.service';

const refreshAllSpy = spyOn(agentRegistryService, 'refreshAll').mockResolvedValue({ refreshed: 2, failed: 0 } as any);

afterAll(() => {
  refreshAllSpy.mockRestore();
});

describe('sync job', () => {
  beforeEach(() => {
    refreshAllSpy.mockReset();
    refreshAllSpy.mockResolvedValue({ refreshed: 2, failed: 0 } as any);
  });

  it('calls agentRegistryService.refreshAll', async () => {
    await runSync();
    expect(refreshAllSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when refreshAll fails', async () => {
    refreshAllSpy.mockRejectedValue(new Error('network error'));
    await expect(runSync()).resolves.toBeUndefined();
  });
});
