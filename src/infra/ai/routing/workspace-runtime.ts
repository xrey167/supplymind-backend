import { createRuntime, withFallbackRuntime, withHealthTracking } from '../runtime-factory';
import { StrategyRouter } from './strategy-router';
import { routingConfigService } from '../../../modules/routing-config/routing-config.service';
import { routingConfigRepo } from '../../../modules/routing-config/routing-config.repo';
import { getUsageCounts, incrementUsage, setLastKnownGood, getLastKnownGood } from './usage-counter';
import { getAllHealth } from '../health-store';
import { getOpenProviders } from '../circuit-breaker';
import type { AgentRuntime } from '../types';
import type { RoutingConfig } from './types';

export interface WorkspaceRuntimeOptions {
  workspaceId: string;
  excludedProviders?: string[];
}

const REDIS_STRATEGIES = new Set(['least-used', 'fill-first', 'p2c', 'auto', 'lkgp']);

/**
 * Build an AgentRuntime for a workspace by:
 * 1. Looking up the workspace's routing config (if any)
 * 2. Excluding providers with open circuit breakers
 * 3. Fetching Redis-backed context (usage counts, health metrics, LKGP)
 * 4. Using StrategyRouter to pick a provider
 * 5. Wrapping the primary runtime with health tracking
 * 6. Building a fallback chain for remaining providers
 * 7. Falling back to default Anthropic runtime if no config exists
 */
export async function buildWorkspaceRuntime(opts: WorkspaceRuntimeOptions): Promise<AgentRuntime> {
  const { workspaceId, excludedProviders = [] } = opts;

  const config = await routingConfigService.getConfig(workspaceId);
  if (!config || config.providers.length === 0) {
    return createRuntime('anthropic', 'raw');
  }

  const providerKeys = config.providers.map((p) => p.provider);

  // Exclude circuit-open providers
  const circuitOpen = await getOpenProviders(workspaceId, providerKeys);
  const excluded = new Set([...excludedProviders, ...circuitOpen]);

  // Fetch Redis-backed context only for strategies that need it
  const ctxExtra = await buildStrategyContext(config, workspaceId);

  const router = new StrategyRouter(config);

  let primary: Awaited<ReturnType<StrategyRouter['select']>>;
  try {
    primary = await router.select(excluded, ctxExtra);

    // Persist strategy-specific state
    if (config.strategy === 'round-robin') {
      await routingConfigRepo.incrementRoundRobinCounter(config.id, router.currentCounter);
    } else if (config.strategy === 'strict-random') {
      await routingConfigRepo.updateStrictRandomDeck(config.id, router.currentDeck);
    }

    // Record usage and LKGP (fire-and-forget)
    if (REDIS_STRATEGIES.has(config.strategy) || config.strategy === 'lkgp') {
      incrementUsage(workspaceId, primary.provider).catch(() => {});
      setLastKnownGood(workspaceId, primary.provider).catch(() => {});
    }
  } catch {
    return createRuntime('anthropic', 'raw');
  }

  // Build runtime for primary provider with health tracking
  const primaryRuntime = withHealthTracking(
    createRuntime(primary.provider, primary.mode ?? 'raw'),
    { workspaceId, provider: primary.provider },
  );

  // Build fallback chain: remaining non-excluded providers in priority order
  const fallbackEntries = config.providers.filter(
    (p) => p.provider !== primary.provider && !excluded.has(p.provider),
  );

  if (fallbackEntries.length === 0) {
    return primaryRuntime;
  }

  const runtimes: AgentRuntime[] = [
    primaryRuntime,
    ...fallbackEntries.map((e) =>
      withHealthTracking(
        createRuntime(e.provider, e.mode ?? 'raw'),
        { workspaceId, provider: e.provider },
      ),
    ),
  ];
  return withFallbackRuntime(runtimes);
}

async function buildStrategyContext(
  config: RoutingConfig,
  workspaceId: string,
): Promise<{ usageCounts?: Map<string, number>; health?: Map<string, import('../health-store').ProviderHealthMetrics>; lastKnownGood?: string | null }> {
  const strategy = config.strategy;
  const providerKeys = config.providers.map((p) => p.provider);

  if (strategy === 'least-used' || strategy === 'fill-first' || strategy === 'auto') {
    const usageCounts = await getUsageCounts(workspaceId);
    if (strategy === 'auto') {
      const health = await getAllHealth(workspaceId, providerKeys);
      return { usageCounts, health };
    }
    return { usageCounts };
  }

  if (strategy === 'p2c') {
    const health = await getAllHealth(workspaceId, providerKeys);
    return { health };
  }

  if (strategy === 'lkgp') {
    const lastKnownGood = await getLastKnownGood(workspaceId);
    return { lastKnownGood };
  }

  return {};
}
