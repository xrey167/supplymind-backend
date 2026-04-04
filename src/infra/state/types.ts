export interface StateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlMs: number): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  close(): Promise<void>;
  readonly backend: 'redis' | 'memory';
}
