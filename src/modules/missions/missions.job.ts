import type { Job } from 'bullmq';
import type { MissionJobData } from '../../plugins/mission-kernel';
import { missionsService } from './missions.service';
import { logger } from '../../config/logger';

export async function processMissionJob(job: Job<MissionJobData>): Promise<void> {
  const { missionId, workspaceId } = job.data;
  logger.info({ missionId, workspaceId }, 'Processing mission job');

  const result = await missionsService.start(missionId);
  if (!result.ok) {
    logger.warn({ missionId, error: result.error.message }, 'Mission start failed in job processor');
    throw result.error;
  }

  logger.info({ missionId }, 'Mission job processed — status: running');
}
