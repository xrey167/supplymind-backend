// src/plugins/erp-bc/skills/sync-now.ts

import { ok, err } from '../../../core/result';
import type { Result } from '../../../core/result';
import { db } from '../../../infra/db/client';
import { syncJobs, pluginInstallations } from '../../../infra/db/schema';
import { and, eq } from 'drizzle-orm';

export async function syncNow(args: Record<string, unknown>): Promise<Result<unknown>> {
  const workspaceId = args.workspaceId as string;
  const entityType = args.entityType as string;
  const installationId = args.installationId as string;

  if (!workspaceId || !entityType || !installationId) return err(new Error('workspaceId, entityType, and installationId are required'));

  // Verify the installation belongs to this workspace to prevent cross-workspace data association
  const [installation] = await db.select({ id: pluginInstallations.id })
    .from(pluginInstallations)
    .where(and(eq(pluginInstallations.id, installationId), eq(pluginInstallations.workspaceId, workspaceId)))
    .limit(1);
  if (!installation) return err(new Error('Installation not found in this workspace'));

  let [job] = await db.select().from(syncJobs)
    .where(and(eq(syncJobs.workspaceId, workspaceId), eq(syncJobs.entityType, entityType)))
    .limit(1);

  if (!job) {
    const [created] = await db.insert(syncJobs).values({
      installationId,
      workspaceId,
      entityType,
      status: 'idle',
    }).returning();
    job = created!;
  }

  const { Queue } = await import('bullmq');
  const { redis } = await import('../../../infra/queue/bullmq');
  const queue = new Queue('erp-sync', { connection: redis });
  try {
    const bullJob = await queue.add('sync', { jobId: job.id }, { attempts: 3 });
    return ok({ jobId: job.id, bullJobId: bullJob.id, entityType, status: 'queued' });
  } finally {
    await queue.close();
  }
}
