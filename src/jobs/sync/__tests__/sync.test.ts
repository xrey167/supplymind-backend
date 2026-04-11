import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from 'bun:test';

const _realSyncLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realSyncLogger,
  logger: new Proxy(_realSyncLogger.logger, {
    get(target: any, prop: string | symbol) {
      if (prop === 'info' || prop === 'warn' || prop === 'error' || prop === 'debug') return () => {};
      return target[prop];
    },
  }),
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
