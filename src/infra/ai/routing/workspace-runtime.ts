import { createRuntime, withFallbackRuntime } from '../runtime-factory';
import { StrategyRouter } from './strategy-router';
import { routingConfigService } from '../../../modules/routing-config/routing-config.service';
import { routingConfigRepo } from '../../../modules/routing-config/routing-config.repo';
import type { AgentRuntime } from '../types';
import type { IntentTier } from '../../../core/ai/types';

export interface WorkspaceRuntimeOptions {
  workspaceId: string;
  tier: IntentTier;
  excludedProviders?: string[];
}

/**
 * Build an AgentRuntime for a workspace by:
 * 1. Looking up the workspace's routing config (if any)
 * 2. Using StrategyRouter to pick a provider
 * 3. Falling back to the default Anthropic runtime if no config exists
 */
export async function buildWorkspaceRuntime(opts: WorkspaceRuntimeOptions): Promise<AgentRuntime> {
  const { workspaceId, excludedProviders = [] } = opts;

  const config = await routingConfigService.getConfig(workspaceId);
  if (!config || config.providers.length === 0) {
    return createRuntime('anthropic', 'raw');
  }

  const router = new StrategyRouter(config);
  const excluded = new Set(excludedProviders);

  let primary: ReturnType<StrategyRouter['select']>;
  try {
    primary = router.select(excluded);
    if (config.strategy === 'round-robin') {
      await routingConfigRepo.incrementRoundRobinCounter(config.id, router.currentCounter);
    }
  } catch {
    return createRuntime('anthropic', 'raw');
  }

  // Build fallback chain: primary target + remaining providers in priority order
  const fallbackEntries = config.providers.filter((p) => p.provider !== primary.provider);
  if (fallbackEntries.length === 0) {
    return createRuntime(primary.provider, primary.mode ?? 'raw');
  }

  const runtimes: AgentRuntime[] = [
    createRuntime(primary.provider, primary.mode ?? 'raw'),
    ...fallbackEntries.map((e) => createRuntime(e.provider, e.mode ?? 'raw')),
  ];
  return withFallbackRuntime(runtimes);
}
