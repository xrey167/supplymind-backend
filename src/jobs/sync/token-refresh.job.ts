import { Worker, Queue } from 'bullmq';
import { redisClient } from '../../infra/redis/client';
import { oauthConnectionsService } from '../../modules/oauth-connections/oauth-connections.service';
import { logger } from '../../config/logger';

const QUEUE_NAME = 'oauth-token-refresh';
/** Refresh tokens expiring within the next 30 minutes */
const REFRESH_WINDOW_MS = 30 * 60 * 1000;

export const tokenRefreshQueue = new Queue(QUEUE_NAME, { connection: redisClient });

export function startTokenRefreshWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      logger.info('Running proactive OAuth token refresh scan');
      await oauthConnectionsService.refreshExpiringSoon(REFRESH_WINDOW_MS);
    },
    { connection: redisClient },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Token refresh job failed');
  });

  return worker;
}

/** Schedule recurring refresh — call once at startup */
export async function scheduleTokenRefresh() {
  // Run every 15 minutes
  await tokenRefreshQueue.add('refresh', {}, {
    repeat: { every: 15 * 60 * 1000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  });
}
