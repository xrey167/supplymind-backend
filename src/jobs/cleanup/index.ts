import { taskRepo } from '../../infra/a2a/task-repo';
import { sessionsService } from '../../modules/sessions/sessions.service';
import { apiKeysRepo } from '../../modules/api-keys/api-keys.repo';
import { logger } from '../../config/logger';

const STALE_WORKING_MS = 30 * 60 * 1000;
const STALE_SUBMITTED_MS = 60 * 60 * 1000;

export async function runCleanup(): Promise<void> {
  try {
    const staleTasks = await taskRepo.findStale('working', STALE_WORKING_MS);
    for (const task of staleTasks) {
      try {
        await taskRepo.updateStatus(task.id, 'failed', undefined, undefined);
        logger.info({ taskId: task.id }, 'Cleanup: marked stale working task as failed');
      } catch (err) {
        logger.error({ taskId: task.id, err }, 'Cleanup: failed to update stale working task');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: stale working tasks step failed');
  }

  try {
    const staleSubmitted = await taskRepo.findStale('submitted', STALE_SUBMITTED_MS);
    for (const task of staleSubmitted) {
      try {
        await taskRepo.updateStatus(task.id, 'failed', undefined, undefined);
        logger.info({ taskId: task.id }, 'Cleanup: marked stale submitted task as failed');
      } catch (err) {
        logger.error({ taskId: task.id, err }, 'Cleanup: failed to update stale submitted task');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: stale submitted tasks step failed');
  }

  try {
    const expired = await sessionsService.expireIdleSessions();
    if (expired > 0) logger.info({ count: expired }, 'Cleanup: expired idle sessions');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expire sessions step failed');
  }

  try {
    const deleted = await apiKeysRepo.deleteExpired();
    if (deleted > 0) logger.info({ count: deleted }, 'Cleanup: deleted expired API keys');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expired API keys step failed');
  }
}
