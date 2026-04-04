export { type StateStore } from './types';
export { MemoryStateStore } from './memory-state-store';
export { RedisStateStore } from './redis-state-store';

import { MemoryStateStore } from './memory-state-store';
import { RedisStateStore } from './redis-state-store';
import type { StateStore } from './types';

let _store: StateStore | null = null;

export function getStateStore(): StateStore {
  if (!_store) {
    const redisUrl = Bun.env.REDIS_URL;
    _store = redisUrl
      ? new RedisStateStore(redisUrl)
      : new MemoryStateStore();
  }
  return _store;
}

export async function closeStateStore(): Promise<void> {
  if (_store) {
    await _store.close();
    _store = null;
  }
}
