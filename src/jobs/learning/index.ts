/**
 * Learning Cycle BullMQ Worker
 *
 * Repeatable job (default: 1h interval) that triggers the learning engine
 * cycle across all workspaces.
 */

import { Worker, type Job } from 'bullmq';
import { learningQueue, redis as connection } from '../../infra/queue/bullmq';
import { learningEngine } from '../../modules/learning/learning.engine';
import { logger } from '../../config/logger';

export const LEARNING_CYCLE_JOB_NAME = 'learning-cycle';
export const LEARNING_CYCLE_KEY = 'global-cycle';
export const LEARNING_CYCLE_INTERVAL_MS = parseInt(Bun.env.LEARNING_CYCLE_INTERVAL_MS ?? '3600000'); // 1h

export async function enqueueLearningCycle(): Promise<void> {
  await learningQueue.add(
    LEARNING_CYCLE_JOB_NAME,
    {},
    {
      jobId: LEARNING_CYCLE_KEY,
      repeat: { every: LEARNING_CYCLE_INTERVAL_MS },
      removeOnComplete: 10,
      removeOnFail: 5,
    },
  );
  logger.info({ intervalMs: LEARNING_CYCLE_INTERVAL_MS }, 'Learning cycle job enqueued');
}

export function createLearningCycleWorker(): Worker {
  return new Worker(
    'learning-cycle',
    async (_job: Job) => {
      logger.info('Learning cycle started');
      await learningEngine.runCycle();
    },
    { connection, concurrency: 1 },
  );
}
