import { agentRegistryService } from '../../modules/agent-registry/agent-registry.service';
import { logger } from '../../config/logger';
import { scheduleTokenRefresh, startTokenRefreshWorker } from './token-refresh.job';

export async function runSync(): Promise<void> {
  try {
    const result = await agentRegistryService.refreshAll();
    logger.info(result, 'Sync: agent registry refresh complete');
  } catch (err) {
    logger.error({ err }, 'Sync: agent registry refresh failed');
  }
}

export async function startSyncJobs(): Promise<void> {
  await scheduleTokenRefresh();
  startTokenRefreshWorker();
  logger.info('Sync: OAuth token refresh job scheduled (every 15 min)');
}
