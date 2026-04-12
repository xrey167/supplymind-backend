import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockList = mock(async () => [
  { id: 'inst-1', pluginId: 'erp-bc', workspaceId: 'ws-1', enabled: true },
]);
const mockRunHealthCheck = mock(async () => ({ ok: true, latencyMs: 42 }));

mock.module('../../../src/modules/plugins/plugins.repo', () => ({
  pluginInstallationRepo: { listEnabled: mockList, findById: mock(async () => undefined) },
}));
mock.module('../../../src/modules/plugins/plugins.service', () => ({
  pluginsService: { runHealthCheck: mockRunHealthCheck },
}));
mock.module('../../../src/infra/observability/metrics', () => ({
  getMetrics: () => ({
    pluginHealthGauge: { addCallback: mock(() => {}) },
    taskCounter: { add: mock(() => {}) },
    taskDuration: { record: mock(() => {}) },
    syncRecordCounter: { add: mock(() => {}) },
    intentGateLatency: { record: mock(() => {}) },
    rateLimit: { add: mock(() => {}) },
  }),
}));

import { processHealthCheckJob } from '../../../src/infra/queue/workers/plugin-health.worker';

describe('plugin-health worker', () => {
  beforeEach(() => {
    mockList.mockClear();
    mockRunHealthCheck.mockClear();
  });

  test('processes health check for each enabled installation', async () => {
    await processHealthCheckJob();
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockRunHealthCheck).toHaveBeenCalledWith('ws-1', 'inst-1');
  });

  test('handles multiple installations', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'inst-1', pluginId: 'erp-bc', workspaceId: 'ws-1', enabled: true },
      { id: 'inst-2', pluginId: 'erp-bc', workspaceId: 'ws-2', enabled: true },
    ]);
    await processHealthCheckJob();
    expect(mockRunHealthCheck).toHaveBeenCalledTimes(2);
  });

  test('does not throw when no installations', async () => {
    mockList.mockResolvedValueOnce([]);
    await expect(processHealthCheckJob()).resolves.toBeUndefined();
  });
});
