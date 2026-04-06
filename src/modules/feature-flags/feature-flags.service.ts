import { DEFAULT_FLAGS, type FlagValue } from '../../config/flags';
import { featureFlagsRepo } from './feature-flags.repo';
import { getCacheProvider } from '../../infra/cache';
import { logger } from '../../config/logger';

const CACHE_TTL_MS = 60_000;

class FeatureFlagsService {
  private cacheKey(workspaceId: string, flag: string): string {
    return `ff:${workspaceId}:${flag}`;
  }

  async getValue<T extends FlagValue = FlagValue>(workspaceId: string, flag: string): Promise<T> {
    const cKey = this.cacheKey(workspaceId, flag);
    const cache = getCacheProvider();
    const cached = await cache.get<T>(cKey);
    if (cached !== undefined) return cached;

    try {
      const value = (await featureFlagsRepo.get(workspaceId, flag) ?? DEFAULT_FLAGS[flag] ?? null) as T;
      await cache.set(cKey, value, CACHE_TTL_MS);
      return value;
    } catch (err) {
      logger.warn({ workspaceId, flag, err }, 'FlagService: DB read failed, using default');
      return (DEFAULT_FLAGS[flag] ?? null) as T;
    }
  }

  async isEnabled(workspaceId: string, flag: string): Promise<boolean> {
    return Boolean(await this.getValue(workspaceId, flag));
  }

  async setFlag(workspaceId: string, flag: string, value: FlagValue): Promise<void> {
    await featureFlagsRepo.set(workspaceId, flag, value);
    await getCacheProvider().clear(`ff:${workspaceId}:`);
  }

  async getAll(workspaceId: string): Promise<Record<string, FlagValue>> {
    const cKey = `ff:${workspaceId}:__all__`;
    const cache = getCacheProvider();
    const cached = await cache.get<Record<string, FlagValue>>(cKey);
    if (cached !== undefined) return cached;

    const result: Record<string, FlagValue> = { ...DEFAULT_FLAGS };
    try {
      const overrides = await featureFlagsRepo.getAll(workspaceId);
      Object.assign(result, overrides);
    } catch (err) {
      logger.warn({ workspaceId, err }, 'FlagService: getAll failed, returning defaults');
    }
    await cache.set(cKey, result, CACHE_TTL_MS);
    return result;
  }

  async invalidateCache(workspaceId: string): Promise<void> {
    await getCacheProvider().clear(`ff:${workspaceId}:`);
  }
}

export const featureFlagsService = new FeatureFlagsService();
