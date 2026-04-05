import { agentRegistryService } from '../../modules/agent-registry/agent-registry.service';
import { logger } from '../../config/logger';

export async function runSync(): Promise<void> {
  try {
    const result = await agentRegistryService.refreshAll();
    logger.info(result, 'Sync: agent registry refresh complete');
  } catch (err) {
    logger.error({ err }, 'Sync: agent registry refresh failed');
  }
}
