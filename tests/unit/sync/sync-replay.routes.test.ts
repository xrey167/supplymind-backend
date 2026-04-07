import { describe, test, expect, mock } from 'bun:test';
import { Hono } from 'hono';

const mockResetFailed = mock(async () => ({ replayed: 2 }));

mock.module('../../../src/plugins/erp-bc/sync/sync-jobs.repo', () => ({
  syncJobsRepo: {
    list: mock(async () => []),
    findById: mock(async () => undefined),
    create: mock(async () => ({})),
    delete: mock(async () => ({ deleted: true })),
    resetFailed: mockResetFailed,
  },
}));

import { syncReplayRoutes } from '../../../src/plugins/erp-bc/sync/sync-replay.routes';

describe('sync-replay routes', () => {
  const app = new Hono();
  app.route('/sync', syncReplayRoutes);

  test('POST /sync/replay triggers replay and returns counts', async () => {
    const res = await app.request('/sync/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.replayed).toBe(2);
    expect(body.skipped).toBe(0);
  });

  test('POST /sync/replay rejects missing workspaceId', async () => {
    const res = await app.request('/sync/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
