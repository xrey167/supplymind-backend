// src/infra/queue/workers/erp-sync.worker.ts

import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { logger } from '../../../config/logger';
import { db } from '../../db/client';
import { syncJobs, pluginInstallations } from '../../db/schema';
import { eq } from 'drizzle-orm';

/**
 * BullMQ worker for ERP sync jobs.
 * Job data shape: { jobId: string }
 */
export function createErpSyncWorker(connection: Redis) {
  const worker = new Worker(
    'erp-sync',
    async (job) => {
      const { jobId } = job.data as { jobId: string };
      logger.info({ jobId, attempt: job.attemptsMade }, 'ERP sync job starting');

      const [syncJob] = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
      if (!syncJob) {
        logger.warn({ jobId }, 'Sync job not found — skipping');
        return;
      }

      // BC credentials live on the pluginInstallations row, not on syncJobs
      const [installation] = await db.select().from(pluginInstallations)
        .where(eq(pluginInstallations.id, syncJob.installationId)).limit(1);
      const bcConfig = installation?.config as any;
      if (!bcConfig?.tenantId) {
        logger.warn({ jobId, installationId: syncJob.installationId }, 'No BC config on installation — skipping');
        return;
      }

      const { getCacheProvider } = await import('../../cache');
      const cache = getCacheProvider();
      const { BcClient } = await import('../../../plugins/erp-bc/connector/bc-client');
      const client = new BcClient(bcConfig, {
        get: (k) => cache.get<string>(k).then(v => v ?? null),
        set: (k, v, t) => cache.set(k, v, t),
      });

      const { runSync } = await import('../../../plugins/erp-bc/sync/sync-runner');
      const { inboxService } = await import('../../../modules/inbox/inbox.service');

      const notify = async (workspaceId: string, title: string, body: string, sourceId: string) => {
        await inboxService.add({ workspaceId, type: 'alert', title, body, sourceType: 'task', sourceId });
      };

      const result = await runSync(jobId, client, notify);
      logger.info({ jobId, result }, 'ERP sync job completed');
    },
    {
      connection,
      concurrency: 3,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.data?.jobId, bullJobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'ERP sync worker job failed');
  });

  return worker;
}
