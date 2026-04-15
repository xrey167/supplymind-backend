/**
 * ERP BC Cron Scheduler
 *
 * Manages BullMQ repeatable job schedulers for sync_jobs rows that
 * have a cron `schedule` value. The queue name must match the worker
 * in `src/plugins/erp-bc/workers/erp-sync.worker.ts` ('erp-sync').
 */

import { Queue } from 'bullmq';
import { redis as connection } from '../../../infra/queue/bullmq';
import { syncJobsRepo } from './sync-jobs.repo';
import { logger } from '../../../config/logger';

const ERP_SYNC_QUEUE_NAME = 'erp-sync';
const SCHEDULER_KEY_PREFIX = 'erp-sync-cron';

// Lazy singleton — avoids creating the Queue before the Redis connection is ready.
let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(ERP_SYNC_QUEUE_NAME, { connection });
  }
  return _queue;
}

/**
 * Register or update a single BullMQ repeatable job for the given sync job.
 */
export async function upsertSyncSchedule(syncJobId: string, schedule: string): Promise<void> {
  const key = `${SCHEDULER_KEY_PREFIX}:${syncJobId}`;
  await getQueue().upsertJobScheduler(
    key,
    { pattern: schedule },
    { name: 'erp-sync', data: { jobId: syncJobId } },
  );
  logger.info({ syncJobId, schedule, key }, 'ERP sync schedule upserted');
}

/**
 * Remove the repeatable job for the given sync job.
 */
export async function removeSyncSchedule(syncJobId: string): Promise<void> {
  const key = `${SCHEDULER_KEY_PREFIX}:${syncJobId}`;
  await getQueue().removeJobScheduler(key);
  logger.info({ syncJobId, key }, 'ERP sync schedule removed');
}

/**
 * Bootstrap all scheduled sync jobs from the database at server startup.
 * Invalid cron patterns are logged and skipped — they must not crash startup.
 */
export async function bootstrapErpSyncSchedules(): Promise<void> {
  let jobs;
  try {
    jobs = await syncJobsRepo.listScheduled();
  } catch (err) {
    logger.error({ err }, 'ERP sync scheduler: failed to load scheduled jobs from DB');
    return;
  }

  logger.info({ count: jobs.length }, 'ERP sync scheduler: bootstrapping repeatable jobs');

  for (const job of jobs) {
    if (!job.schedule) continue;
    try {
      await upsertSyncSchedule(job.id, job.schedule);
    } catch (err) {
      logger.error({ err, syncJobId: job.id, schedule: job.schedule }, 'ERP sync scheduler: failed to register schedule — skipping');
    }
  }
}
