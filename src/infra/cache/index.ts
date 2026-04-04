export { type CacheProvider } from './types';
export { MemoryCache } from './memory-cache';
export { RedisCache } from './redis-cache';

import { MemoryCache } from './memory-cache';
import type { CacheProvider } from './types';

let _cache: CacheProvider | null = null;

export function getCacheProvider(): CacheProvider {
  if (!_cache) {
    _cache = new MemoryCache();
  }
  return _cache;
}

export function setCacheProvider(provider: CacheProvider): void {
  _cache = provider;
}
