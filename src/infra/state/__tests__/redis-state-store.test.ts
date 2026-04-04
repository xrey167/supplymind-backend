import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RedisStateStore } from '../redis-state-store';
import type { StateStore } from '../types';

// These tests require a running Redis instance at REDIS_URL or localhost:6379.
// They are skipped in CI if Redis is not available.
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let store: StateStore;
let available = true;

try {
  store = new RedisStateStore(REDIS_URL);
  await store.set('__ping', 'pong', 1000);
} catch {
  available = false;
}

const describeRedis = available ? describe : describe.skip;

describeRedis('RedisStateStore', () => {
  beforeEach(async () => {
    store = new RedisStateStore(REDIS_URL);
    // Clean test keys
    const keys = await store.keys('test:*');
    for (const k of keys) await store.del(k);
  });

  afterEach(async () => {
    await store.close();
  });

  test('get returns null for missing key', async () => {
    expect(await store.get('test:missing')).toBeNull();
  });

  test('set and get round-trip', async () => {
    await store.set('test:k1', 'v1');
    expect(await store.get('test:k1')).toBe('v1');
  });

  test('set with TTL expires entry', async () => {
    await store.set('test:ttl', 'val', 100);
    expect(await store.get('test:ttl')).toBe('val');
    await new Promise((r) => setTimeout(r, 200));
    expect(await store.get('test:ttl')).toBeNull();
  });

  test('del removes key', async () => {
    await store.set('test:del', 'val');
    expect(await store.del('test:del')).toBe(true);
    expect(await store.get('test:del')).toBeNull();
  });

  test('incr creates and increments', async () => {
    expect(await store.incr('test:ctr')).toBe(1);
    expect(await store.incr('test:ctr')).toBe(2);
  });

  test('backend returns redis', () => {
    expect(store.backend).toBe('redis');
  });
});
