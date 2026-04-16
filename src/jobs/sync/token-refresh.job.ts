import { Worker, Queue } from 'bullmq';
import { createWorkerRedisConnection } from '../../infra/redis/client';
import { oauthConnectionsService } from '../../modules/oauth-connections/oauth-connections.service';
import { logger } from '../../config/logger';

const QUEUE_NAME = 'oauth-token-refresh';
/** Refresh tokens expiring within the next 30 minutes */
const REFRESH_WINDOW_MS = 30 * 60 * 1000;

// Lazy singleton — do NOT connect to Redis at module load time (breaks tests)
let _queue: Queue | null = null;
let _connection: ReturnType<typeof createWorkerRedisConnection> | null = null;

function getConnection() {
  if (!_connection) _connection = createWorkerRedisConnection();
  return _connection;
}

function getQueue(): Queue {
  if (!_queue) _queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  return _queue;
}

export function startTokenRefreshWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      logger.info('Running proactive OAuth token refresh scan');
      await oauthConnectionsService.refreshExpiringSoon(REFRESH_WINDOW_MS);
    },
    { connection: getConnection() },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Token refresh job failed');
  });

  return worker;
}

/** Schedule recurring refresh — call once at startup */
export async function scheduleTokenRefresh() {
  // Run every 15 minutes
  await getQueue().add('refresh', {}, {
    repeat: { every: 15 * 60 * 1000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  });
}
