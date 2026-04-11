import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { syncJobsRepo } from './sync-jobs.repo';

const createSchema = z.object({
  installationId: z.string(),
  workspaceId: z.string(),
  entity: z.string(),
  schedule: z.string().optional(),
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
  return c.json(job, 201);
});

syncJobsRoutes.delete('/:id', async (c) => {
  const result = await syncJobsRepo.delete(c.req.param('id'));
  return c.json(result);
});
