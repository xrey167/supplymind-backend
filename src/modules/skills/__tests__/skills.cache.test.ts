import { describe, test, expect, beforeEach } from 'bun:test';
import { SkillCache } from '../skills.cache';

describe('SkillCache', () => {
  let cache: SkillCache;

  beforeEach(() => {
    cache = new SkillCache();
  });

  test('set and get a cached value', () => {
    cache.set('echo', { msg: 'hi' }, 'result');
    expect(cache.get('echo', { msg: 'hi' })).toBe('result');
  });

  test('returns undefined for cache miss', () => {
    expect(cache.get('nope', {})).toBeUndefined();
  });

  test('same key with different args returns undefined', () => {
    cache.set('echo', { a: 1 }, 'r1');
    expect(cache.get('echo', { a: 2 })).toBeUndefined();
  });

  test('evicts oldest entry when maxSize exceeded', () => {
    cache.maxSize = 2;
    cache.set('a', {}, 'r1');
    cache.set('b', {}, 'r2');
    cache.set('c', {}, 'r3');
    // 'a' should be evicted
    expect(cache.get('a', {})).toBeUndefined();
    expect(cache.get('b', {})).toBe('r2');
    expect(cache.get('c', {})).toBe('r3');
  });

  test('expired entries are not returned', () => {
    cache.set('echo', {}, 'val');
    // Manually expire by patching the internal map
    const key = cache.getCacheKey('echo', {});
    const internal = (cache as any).cache as Map<string, any>;
    const entry = internal.get(key)!;
    entry.timestamp = Date.now() - 6 * 60 * 1000; // 6 min ago (TTL is 5 min)
    expect(cache.get('echo', {})).toBeUndefined();
  });

  test('clear resets cache and stats', () => {
    cache.set('a', {}, 'r');
    cache.get('a', {}); // hit
    cache.get('b', {}); // miss
    cache.clear();
    expect(cache.stats()).toEqual({ size: 0, hits: 0, misses: 0 });
  });

  test('stats tracks hits and misses', () => {
    cache.set('a', {}, 'r');
    cache.get('a', {}); // hit
    cache.get('b', {}); // miss
    cache.get('c', {}); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.size).toBe(1);
  });
});
