import type { CacheProvider } from './types';

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

export class MemoryCache implements CacheProvider {
  private data = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(opts: { maxSize?: number } = {}) {
    this.maxSize = opts.maxSize ?? 500;
  }

  private alive(entry: CacheEntry | undefined): entry is CacheEntry {
    if (!entry) return false;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) return false;
    return true;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.data.get(key);
    if (!this.alive(entry)) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (this.data.size >= this.maxSize && !this.data.has(key)) {
      const oldest = this.data.keys().next().value!;
      this.data.delete(oldest);
    }
    this.data.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async clear(pattern?: string): Promise<void> {
    if (!pattern) {
      this.data.clear();
      return;
    }
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );
    for (const k of this.data.keys()) {
      if (regex.test(k)) this.data.delete(k);
    }
  }
}
