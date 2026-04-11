import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { syncJobsRepo } from './sync-jobs.repo';

const replaySchema = z.object({
  workspaceId: z.string(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const syncReplayRoutes = new Hono();

syncReplayRoutes.post(
  '/replay',
  zValidator('json', replaySchema),
  async (c) => {
    const { workspaceId, limit } = c.req.valid('json');
    const result = await syncJobsRepo.resetFailed(workspaceId, limit);
    return c.json({ replayed: result.replayed, skipped: 0 });
  },
);
