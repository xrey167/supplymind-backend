const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class SkillCache {
  maxSize = 500;
  private cache: Map<string, { result: unknown; timestamp: number }> = new Map();
  private hits = 0;
  private misses = 0;

  getCacheKey(skillId: string, args: unknown): string {
    const raw = `${skillId}:${JSON.stringify(args)}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return `${skillId}:${hash}`;
  }

  get(skillId: string, args: unknown): unknown | undefined {
    const key = this.getCacheKey(skillId, args);
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() - entry.timestamp > DEFAULT_TTL_MS) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.result;
  }

  set(skillId: string, args: unknown, result: unknown): void {
    const key = this.getCacheKey(skillId, args);
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { size: number; hits: number; misses: number } {
    return { size: this.cache.size, hits: this.hits, misses: this.misses };
  }
}

export const skillCache = new SkillCache();
