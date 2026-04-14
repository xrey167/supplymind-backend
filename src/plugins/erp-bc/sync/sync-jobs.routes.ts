import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { syncJobsRepo } from './sync-jobs.repo';
import { upsertSyncSchedule, removeSyncSchedule } from '../../../jobs/erp-sync-scheduler';
import { logger } from '../../../config/logger';

const createSchema = z.object({
  installationId: z.string(),
  workspaceId: z.string(),
  entity: z.string(),
  schedule: z.string().optional(),
});

const patchSchema = z.object({
  schedule: z.string().nullable().optional(),
});

export const syncJobsRoutes = new Hono();

syncJobsRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  const jobs = await syncJobsRepo.list(workspaceId);
  return c.json(jobs);
});

syncJobsRoutes.get('/:id', async (c) => {
  const job = await syncJobsRepo.findById(c.req.param('id'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(job);
});

syncJobsRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json');
  const job = await syncJobsRepo.create(data);

  if (data.schedule) {
    upsertSyncSchedule(job.id, data.schedule).catch((err: unknown) =>
      logger.warn({ err, syncJobId: job.id }, 'Failed to register ERP sync schedule after create'),
    );
  }

  return c.json(job, 201);
});

syncJobsRoutes.patch('/:id', zValidator('json', patchSchema), async (c) => {
  const id = c.req.param('id');
  const { schedule } = c.req.valid('json');

  const existing = await syncJobsRepo.findById(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Update the DB record only if schedule is explicitly provided
  if (schedule !== undefined) {
    await syncJobsRepo.updateSchedule(id, schedule);
  }

  if (schedule) {
    upsertSyncSchedule(id, schedule).catch((err: unknown) =>
      logger.warn({ err, syncJobId: id }, 'Failed to upsert ERP sync schedule after patch'),
    );
  } else if (schedule === null) {
    removeSyncSchedule(id).catch((err: unknown) =>
      logger.warn({ err, syncJobId: id }, 'Failed to remove ERP sync schedule after patch'),
    );
  }

  const updated = await syncJobsRepo.findById(id);
  return c.json(updated);
});

syncJobsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const result = await syncJobsRepo.delete(id);

  removeSyncSchedule(id).catch((err: unknown) =>
    logger.warn({ err, syncJobId: id }, 'Failed to remove ERP sync schedule after delete'),
  );

  return c.json(result);
});
