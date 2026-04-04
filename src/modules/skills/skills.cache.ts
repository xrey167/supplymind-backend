import { getCacheProvider } from '../../infra/cache';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class SkillCache {
  private hits = 0;
  private misses = 0;

  getCacheKey(skillId: string, args: unknown): string {
    const raw = `${skillId}:${JSON.stringify(args)}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return `skill:${skillId}:${hash}`;
  }

  async get(skillId: string, args: unknown): Promise<unknown | undefined> {
    const key = this.getCacheKey(skillId, args);
    const result = await getCacheProvider().get(key);
    if (result === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return result;
  }

  async set(skillId: string, args: unknown, result: unknown): Promise<void> {
    const key = this.getCacheKey(skillId, args);
    await getCacheProvider().set(key, result, DEFAULT_TTL_MS);
  }

  async clear(): Promise<void> {
    await getCacheProvider().clear('skill:*');
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }
}

export const skillCache = new SkillCache();
