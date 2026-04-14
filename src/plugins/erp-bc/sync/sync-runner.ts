// src/plugins/erp-bc/sync/sync-runner.ts

import { createHash } from 'crypto';
import { db } from '../../../infra/db/client';
import { syncJobs, syncRecords } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { withRetry, DEFAULT_RETRY_POLICY } from './retry-strategy';
import { PermanentError } from './sync-errors';
import type { BcClient } from '../connector/bc-client';
import type { BcEntityType } from '../connector/bc-types';
import { logger } from '../../../config/logger';

export interface SyncRunResult {
  jobId: string;
  entityType: BcEntityType;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  deadLettered: number;
}

export async function runSync(
  jobId: string,
  client: BcClient,
  notify: (workspaceId: string, title: string, body: string, sourceId: string) => Promise<void>,
): Promise<SyncRunResult> {
  const [job] = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Sync job not found: ${jobId}`);

  await db.update(syncJobs).set({ status: 'running', lastRunAt: new Date() }).where(eq(syncJobs.id, jobId));

  const result: SyncRunResult = {
    jobId,
    entityType: job.entityType as BcEntityType,
    created: 0, updated: 0, skipped: 0, failed: 0, deadLettered: 0,
  };

  let nextLink: string | undefined;
  let page = 0;

  const baseFilter = (job.filter as string | null) ?? null;
  const cursorFilter = job.cursor ? `lastModifiedDateTime gt ${job.cursor}` : null;
  const combinedFilter = [cursorFilter, baseFilter].filter(Boolean).join(' and ') || undefined;

  try {
    let maxLastModified: string | null = null;

    do {
      const response = await withRetry(
        () => client.list(job.entityType as BcEntityType, {
          filter: combinedFilter,
          top: job.batchSize,
          skipToken: nextLink ? new URL(nextLink).searchParams.get('$skiptoken') ?? undefined : undefined,
          ...(job.cursor ? { orderby: 'lastModifiedDateTime asc' } : {}),
        }),
        DEFAULT_RETRY_POLICY,
        (error, attempt, delayMs) => {
          logger.warn({ jobId, attempt, delayMs, error: error.message }, 'BC sync retry');
        },
      );

      for (const entity of response.value) {
        const hash = createHash('sha256').update(JSON.stringify(entity)).digest('hex');

        const lmd = (entity as any).lastModifiedDateTime as string | undefined;
        if (lmd) {
          if (!maxLastModified || lmd > maxLastModified) {
            maxLastModified = lmd;
          }
        }

        try {
          await db.insert(syncRecords).values({
            jobId,
            workspaceId: job.workspaceId,
            entityType: job.entityType,
            entityId: entity.id,
            action: 'created',
            payloadHash: hash,
          });
          result.created++;
        } catch (insertErr: any) {
          if (insertErr?.code === '23505') {
            // Unique constraint → already synced — insert skipped record idempotently
            await db.insert(syncRecords).values({
              jobId,
              workspaceId: job.workspaceId,
              entityType: job.entityType,
              entityId: entity.id,
              action: 'skipped',
              payloadHash: hash,
            }).onConflictDoNothing();
            result.skipped++;
          } else {
            throw insertErr;
          }
        }
      }

      nextLink = response['@odata.nextLink'];
      page++;
    } while (nextLink && page < 100); // safety: max 100 pages per run

    // Update cursor to latest entity modification time (or existing cursor if no new data, or now on first run)
    await db.update(syncJobs)
      .set({ status: 'idle', cursor: maxLastModified ?? job.cursor ?? new Date().toISOString(), retryCount: 0, lastError: null })
      .where(eq(syncJobs.id, jobId));

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.update(syncJobs)
      .set({ status: 'failed', lastError: errMsg, retryCount: (job.retryCount ?? 0) + 1 })
      .where(eq(syncJobs.id, jobId));

    if (err instanceof PermanentError) {
      // Dead-letter: write failed record + notify. Use page-scoped entityId to avoid
      // unique index collision on (jobId, entityId, action) across multiple page failures.
      await db.insert(syncRecords).values({
        jobId,
        workspaceId: job.workspaceId,
        entityType: job.entityType,
        entityId: `page-${page}`,
        action: 'failed',
        error: errMsg,
      }).onConflictDoNothing();
      result.deadLettered++;
      await notify(
        job.workspaceId,
        `Sync job failed permanently: ${job.entityType}`,
        errMsg,
        jobId,
      ).catch((notifyErr) => {
        logger.warn({ err: notifyErr, jobId, workspaceId: job.workspaceId }, 'ERP sync: failed to send permanent-failure inbox notification');
      });
    } else {
      throw err; // re-throw transient errors for BullMQ retry
    }
  }

  return result;
}
