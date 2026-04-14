// src/infra/queue/workers/erp-sync.worker.ts

import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { logger } from '../../../config/logger';
import { db } from '../../db/client';
import { syncJobs, pluginInstallations } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { credentialsService } from '../../../modules/credentials/credentials.service';

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

      // Resolve clientSecret: prefer encrypted credential, fall back to plaintext (migration path)
      const secretBindingIds = installation?.secretBindingIds as string[] | undefined;
      let clientSecret: string | undefined;

      if (secretBindingIds?.[0]) {
        const decrypted = await credentialsService.getDecrypted(secretBindingIds[0], syncJob.workspaceId);
        if (decrypted.ok) {
          clientSecret = decrypted.value;
        } else {
          logger.warn({ credentialId: secretBindingIds[0] }, 'Failed to decrypt ERP-BC client secret — falling back to plaintext config');
        }
      }

      // Migration fallback: use plaintext if no secretBindingId yet
      if (!clientSecret) {
        if (!secretBindingIds?.[0]) {
          logger.warn({ workspaceId: syncJob.workspaceId, installationId: syncJob.installationId }, 'ERP-BC installation has no secretBindingId — using plaintext clientSecret (please re-install to encrypt)');
        }
        clientSecret = (installation?.config as any)?.clientSecret;
      }

      if (!clientSecret) {
        throw new Error('ERP-BC client secret not available — cannot run sync');
      }

      const { getCacheProvider } = await import('../../cache');
      const cache = getCacheProvider();
      const { BcClient } = await import('../../../plugins/erp-bc/connector/bc-client');
      const client = new BcClient({ ...bcConfig, clientSecret }, {
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
