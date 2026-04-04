import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SkillCache } from '../skills.cache';
import { setCacheProvider, MemoryCache } from '../../../infra/cache';

describe('SkillCache', () => {
  let cache: SkillCache;

  beforeEach(() => {
    // Reset cache provider to a fresh MemoryCache for each test
    setCacheProvider(new MemoryCache({ maxSize: 500 }));
    cache = new SkillCache();
  });

  afterEach(async () => {
    await cache.clear();
  });

  test('set and get a cached value', async () => {
    await cache.set('echo', { msg: 'hi' }, 'result');
    expect(await cache.get('echo', { msg: 'hi' })).toBe('result');
  });

  test('returns undefined for cache miss', async () => {
    expect(await cache.get('nope', {})).toBeUndefined();
  });

  test('same key with different args returns undefined', async () => {
    await cache.set('echo', { a: 1 }, 'r1');
    expect(await cache.get('echo', { a: 2 })).toBeUndefined();
  });

  test('evicts oldest entry when maxSize exceeded', async () => {
    // Use a small maxSize MemoryCache
    setCacheProvider(new MemoryCache({ maxSize: 2 }));
    cache = new SkillCache();
    await cache.set('a', {}, 'r1');
    await cache.set('b', {}, 'r2');
    await cache.set('c', {}, 'r3');
    // 'a' should be evicted
    expect(await cache.get('a', {})).toBeUndefined();
    expect(await cache.get('b', {})).toBe('r2');
    expect(await cache.get('c', {})).toBe('r3');
  });

  test('clear resets cache and stats', async () => {
    await cache.set('a', {}, 'r');
    await cache.get('a', {}); // hit
    await cache.get('b', {}); // miss
    await cache.clear();
    expect(cache.stats()).toEqual({ hits: 0, misses: 0 });
  });

  test('stats tracks hits and misses', async () => {
    await cache.set('a', {}, 'r');
    await cache.get('a', {}); // hit
    await cache.get('b', {}); // miss
    await cache.get('c', {}); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
  });
});
