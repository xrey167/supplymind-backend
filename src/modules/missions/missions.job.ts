import type { Job } from 'bullmq';
import type { MissionJobData } from './missions.types';
import { missionsService } from './missions.service';
import { missionsRepo } from './missions.repo';
import { compileMission } from './missions.compiler';
import { logger } from '../../config/logger';

export async function processMissionJob(job: Job<MissionJobData>): Promise<void> {
  const { missionId, workspaceId } = job.data;
  logger.info({ missionId, workspaceId }, 'Processing mission job');

  const result = await missionsService.start(missionId);
  if (!result.ok) {
    logger.warn({ missionId, error: result.error.message }, 'Mission start failed in job processor');
    throw result.error;
  }

  const run = result.value;
  const plan = compileMission(run);
  const workers = await missionsRepo.listWorkers(missionId);

  logger.info({ missionId, planKind: plan.kind, workerCount: workers.length }, 'Executing mission');

  const { executeMission } = await import('../../plugins/mission-kernel/executor');
  await executeMission(run, plan, workers);

  logger.info({ missionId }, 'Mission job complete');
}
