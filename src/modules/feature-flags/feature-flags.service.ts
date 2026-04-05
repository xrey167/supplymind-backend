import { logger } from '../../config/logger';
import { DEFAULT_FLAGS, type FlagValue } from '../../config/flags';
import { workspaceSettingsRepo } from '../settings/workspace-settings/workspace-settings.repo';

const FLAG_NAMESPACE = 'feature-flag:';
const CACHE_TTL_MS = 60_000;

class FlagCache {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();

  get(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }
}

const flagCache = new FlagCache();

class FeatureFlagsService {
  private cacheKey(workspaceId: string, flag: string): string {
    return `${workspaceId}:${flag}`;
  }

  private dbKey(flag: string): string {
    return `${FLAG_NAMESPACE}${flag}`;
  }

  async getValue<T extends FlagValue = FlagValue>(workspaceId: string, flag: string): Promise<T> {
    const cKey = this.cacheKey(workspaceId, flag);
    const cached = flagCache.get(cKey);
    if (cached !== undefined) return cached as T;

    try {
      const row = await workspaceSettingsRepo.get(workspaceId, this.dbKey(flag));
      const value = (row?.value ?? DEFAULT_FLAGS[flag] ?? null) as T;
      flagCache.set(cKey, value, CACHE_TTL_MS);
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
    await workspaceSettingsRepo.set(workspaceId, this.dbKey(flag), value);
    flagCache.invalidate(workspaceId);
  }

  async getAll(workspaceId: string): Promise<Record<string, FlagValue>> {
    const result: Record<string, FlagValue> = { ...DEFAULT_FLAGS };
    try {
      const rows = await workspaceSettingsRepo.getAll(workspaceId);
      for (const row of rows) {
        if (row.key.startsWith(FLAG_NAMESPACE)) {
          const flag = row.key.slice(FLAG_NAMESPACE.length);
          result[flag] = row.value as FlagValue;
        }
      }
    } catch (err) {
      logger.warn({ workspaceId, err }, 'FlagService: getAll failed, returning defaults');
    }
    return result;
  }

  invalidateCache(workspaceId: string): void {
    flagCache.invalidate(workspaceId);
  }
}

export const featureFlagsService = new FeatureFlagsService();
