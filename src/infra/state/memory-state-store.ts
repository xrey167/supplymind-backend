import type { StateStore } from './types';

interface Entry {
  value: string;
  expiresAt?: number;
}

export class MemoryStateStore implements StateStore {
  readonly backend = 'memory' as const;
  private data = new Map<string, Entry>();
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(sweepIntervalMs = 30_000) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      (this.sweepTimer as NodeJS.Timeout).unref();
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.data) {
      if (v.expiresAt && v.expiresAt <= now) this.data.delete(k);
    }
  }

  private alive(entry: Entry | undefined): entry is Entry {
    if (!entry) return false;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) return false;
    return true;
  }

  async get(key: string): Promise<string | null> {
    const e = this.data.get(key);
    if (!this.alive(e)) {
      this.data.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async del(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const e = this.data.get(key);
    return this.alive(e);
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const next = (current ? parseInt(current, 10) : 0) + 1;
    await this.set(key, String(next));
    return next;
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    const e = this.data.get(key);
    if (e) {
      e.expiresAt = Date.now() + ttlMs;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );
    const result: string[] = [];
    for (const [k] of this.data) {
      if (this.alive(this.data.get(k)) && regex.test(k)) {
        result.push(k);
      }
    }
    return result;
  }

  async close(): Promise<void> {
    clearInterval(this.sweepTimer);
    this.data.clear();
  }
}
