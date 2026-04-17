import { routingConfigRepo } from './routing-config.repo';
import { getSharedRedisClient } from '../../infra/redis/client';
import { logger } from '../../config/logger';
import type { RoutingConfig, ProviderEntry, RoutingStrategy } from '../../infra/ai/routing/types';

const CACHE_TTL_SEC = 30;
const cacheKey = (wsId: string) => `routing-config:${wsId}`;

export const routingConfigService = {
  async getConfig(workspaceId: string): Promise<RoutingConfig | null> {
    const redis = getSharedRedisClient();
    try {
      const cached = await redis.get(cacheKey(workspaceId));
      if (cached) return JSON.parse(cached) as RoutingConfig;
    } catch (err) { logger.warn({ err }, 'routing-config: Redis cache read failed'); }

    const config = await routingConfigRepo.getForWorkspace(workspaceId);
    if (config) {
      try { await redis.setex(cacheKey(workspaceId), CACHE_TTL_SEC, JSON.stringify(config)); }
      catch (err) { logger.warn({ err }, 'routing-config: Redis cache write failed'); }
    }
    return config;
  },

  async upsert(
    workspaceId: string,
    input: { strategy: RoutingStrategy; providers: ProviderEntry[] },
  ): Promise<RoutingConfig> {
    const config = await routingConfigRepo.upsert(workspaceId, input);
    try { await getSharedRedisClient().del(cacheKey(workspaceId)); }
    catch (err) { logger.warn({ err }, 'routing-config: Redis cache invalidation failed'); }
    return config;
  },
};
