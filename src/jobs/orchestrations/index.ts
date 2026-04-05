import { Worker } from 'bullmq';
import Redis from 'ioredis';
import type { OrchestrationJobData } from '../../infra/queue/bullmq';
import { orchestrationService } from '../../modules/orchestration/orchestration.service';
import { logger } from '../../config/logger';

export function startOrchestrationWorkers(concurrency = 3): { worker: Worker<OrchestrationJobData>; connection: Redis } {
  const connection = new Redis(Bun.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

  const worker = new Worker<OrchestrationJobData>(
    'orchestration-run',
    async (job) => {
      const { orchestrationId, workspaceId, definition, input } = job.data;
      await orchestrationService.run(orchestrationId, workspaceId, definition, input);
    },
    { connection, concurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, orchestrationId: job?.data.orchestrationId, err }, 'Orchestration job failed');
  });

  return { worker, connection };
}
