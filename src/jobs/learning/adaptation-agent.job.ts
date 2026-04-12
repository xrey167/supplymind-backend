/**
 * Adaptation Agent BullMQ Job
 *
 * Per-plugin repeatable job. Enqueued when a plugin is installed,
 * removed when the plugin is uninstalled. Runs plugin-scoped analysis
 * and feeds results to the central learning engine.
 */

import { Worker, type Job } from 'bullmq';
import { adaptationAgentQueue, redis as connection } from '../../infra/queue/bullmq';
import { db } from '../../infra/db/client';
import { adaptationAgents } from '../../infra/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { learningEngine } from '../../modules/learning/learning.engine';
import { logger } from '../../config/logger';

export const ADAPTATION_AGENT_INTERVAL_MS = parseInt(Bun.env.ADAPTATION_AGENT_INTERVAL_MS ?? '3600000'); // 1h

export interface AdaptationAgentJobData {
  workspaceId: string;
  pluginId: string;
}

export function adaptationAgentJobId(workspaceId: string, pluginId: string): string {
  return `adaptation-agent:${workspaceId}:${pluginId}`;
}

export async function enqueueAdaptationAgent(workspaceId: string, pluginId: string): Promise<void> {
  const jobId = adaptationAgentJobId(workspaceId, pluginId);
  await adaptationAgentQueue.add(
    'run',
    { workspaceId, pluginId } satisfies AdaptationAgentJobData,
    {
      jobId,
      repeat: { every: ADAPTATION_AGENT_INTERVAL_MS },
      removeOnComplete: 5,
      removeOnFail: 3,
    },
  );
  logger.info({ workspaceId, pluginId }, 'Adaptation agent job enqueued');
}

export async function removeAdaptationAgent(workspaceId: string, pluginId: string): Promise<void> {
  const jobId = adaptationAgentJobId(workspaceId, pluginId);
  // Remove repeatable job by pattern
  const repeatableJobs = await adaptationAgentQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.id === jobId || job.key?.includes(jobId)) {
      await adaptationAgentQueue.removeRepeatableByKey(job.key);
    }
  }
  logger.info({ workspaceId, pluginId }, 'Adaptation agent job removed');
}

export function createAdaptationAgentWorker(): Worker<AdaptationAgentJobData> {
  return new Worker<AdaptationAgentJobData>(
    'adaptation-agent',
    async (job: Job<AdaptationAgentJobData>) => {
      const { workspaceId, pluginId } = job.data;

      // Run workspace cycle (scoped to this plugin's signals)
      await learningEngine.runCycleForWorkspace(workspaceId);

      // Update last_cycle_at and increment counter
      await db
        .update(adaptationAgents)
        .set({
          lastCycleAt: new Date(),
          cycleCount: sql`${adaptationAgents.cycleCount} + 1`,
        })
        .where(and(
          eq(adaptationAgents.workspaceId, workspaceId),
          eq(adaptationAgents.pluginId, pluginId),
        ));
    },
    { connection, concurrency: 5 },
  );
}
