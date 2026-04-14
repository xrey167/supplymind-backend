import { Worker } from 'bullmq';
import Redis from 'ioredis';
import type { MissionJobData } from '../../infra/queue/bullmq';
import { processMissionJob } from '../../modules/missions/missions.job';
import { logger } from '../../config/logger';

export function startMissionWorkers(concurrency = 3): { worker: Worker<MissionJobData>; connection: Redis } {
  const connection = new Redis(Bun.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

  const worker = new Worker<MissionJobData>('mission-run', processMissionJob, { connection, concurrency });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, missionId: job?.data.missionId, err }, 'Mission job failed');
  });

  return { worker, connection };
}
