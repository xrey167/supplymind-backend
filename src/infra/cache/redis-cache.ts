import Redis from 'ioredis';
import type { CacheProvider } from './types';

export class RedisCache implements CacheProvider {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlMs) {
      await this.client.set(key, serialized, 'PX', ttlMs);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(pattern?: string): Promise<void> {
    if (!pattern) return; // refuse to FLUSHDB
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}
