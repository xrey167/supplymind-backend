import { describe, test, expect, mock } from 'bun:test';
import { Hono } from 'hono';

const fakeJob = {
  id: 'job-1',
  installationId: 'inst-1',
  entityType: 'vendors',
  status: 'idle',
  workspaceId: 'ws-1',
  schedule: null,
  lastRunAt: null,
  lastError: null,
  createdAt: new Date(),
};
const mockList = mock(async () => [fakeJob]);
const mockGet = mock(async (id: string) => (id === 'job-1' ? fakeJob : undefined));
const mockCreate = mock(async () => fakeJob);
const mockDelete = mock(async () => ({ deleted: true }));

mock.module('../../../src/plugins/erp-bc/sync/sync-jobs.repo', () => ({
  syncJobsRepo: {
    list: mockList,
    findById: mockGet,
    create: mockCreate,
    delete: mockDelete,
    resetFailed: mock(async () => ({ replayed: 0 })),
  },
}));

import { syncJobsRoutes } from '../../../src/plugins/erp-bc/sync/sync-jobs.routes';

describe('sync-jobs routes', () => {
  const app = new Hono();
  app.route('/sync-jobs', syncJobsRoutes);

  test('GET /sync-jobs returns list', async () => {
    const res = await app.request('/sync-jobs?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe('job-1');
  });

  test('GET /sync-jobs/:id returns job', async () => {
    const res = await app.request('/sync-jobs/job-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe('job-1');
  });

  test('GET /sync-jobs/:id returns 404 for missing', async () => {
    const res = await app.request('/sync-jobs/missing');
    expect(res.status).toBe(404);
  });

  test('POST /sync-jobs creates job', async () => {
    const res = await app.request('/sync-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: 'inst-1', workspaceId: 'ws-1', entity: 'vendors' }),
    });
    expect(res.status).toBe(201);
  });

  test('DELETE /sync-jobs/:id deletes job', async () => {
    const res = await app.request('/sync-jobs/job-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });
});
