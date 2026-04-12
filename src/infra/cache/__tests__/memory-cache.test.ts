import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryCache } from '../memory-cache';
import type { CacheProvider } from '../types';

describe('MemoryCache', () => {
  let cache: CacheProvider;

  beforeEach(() => {
    cache = new MemoryCache({ maxSize: 10 });
  });

  afterEach(async () => {
    await cache.clear();
  });

  test('get returns undefined for missing key', async () => {
    expect(await cache.get('missing')).toBeUndefined();
  });

  test('set and get round-trip', async () => {
    await cache.set('k1', { foo: 'bar' });
    expect(await cache.get<{ foo: string }>('k1')).toEqual({ foo: 'bar' });
  });

  test('set with TTL expires entry', async () => {
    await cache.set('ttl', 'val', 50);
    expect(await cache.get<string>('ttl')).toBe('val');
    await new Promise((r) => setTimeout(r, 80));
    expect(await cache.get('ttl')).toBeUndefined();
  });

  test('del removes key', async () => {
    await cache.set('del', 'val');
    await cache.del('del');
    expect(await cache.get('del')).toBeUndefined();
  });

  test('evicts oldest when maxSize reached', async () => {
    for (let i = 0; i < 11; i++) {
      await cache.set(`key-${i}`, `val-${i}`);
    }
    expect(await cache.get('key-0')).toBeUndefined();
    expect(await cache.get<string>('key-10')).toBe('val-10');
  });

  test('clear removes all entries', async () => {
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.clear();
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('b')).toBeUndefined();
  });

  test('clear with pattern removes matching keys', async () => {
    await cache.set('user:1', 'a');
    await cache.set('user:2', 'b');
    await cache.set('session:1', 'c');
    await cache.clear('user:*');
    expect(await cache.get('user:1')).toBeUndefined();
    expect(await cache.get<string>('session:1')).toBe('c');
  });
});
