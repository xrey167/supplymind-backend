import Redis from 'ioredis';
import type { StateStore } from './types';

export class RedisStateStore implements StateStore {
  readonly backend = 'redis' as const;
  private client: Redis;

  constructor(url: string) {
    this.client = new Redis(url);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs) {
      await this.client.set(key, value, 'PX', ttlMs);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<boolean> {
    const count = await this.client.del(key);
    return count > 0;
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    await this.client.pexpire(key, ttlMs);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
