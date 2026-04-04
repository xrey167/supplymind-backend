export { type StateStore } from './types';
export { MemoryStateStore } from './memory-state-store';

import { MemoryStateStore } from './memory-state-store';
import type { StateStore } from './types';

let _store: StateStore | null = null;

export function getStateStore(): StateStore {
  if (!_store) {
    // TODO: Add RedisStateStore when REDIS_URL is set (Task 2)
    _store = new MemoryStateStore();
  }
  return _store;
}

export async function closeStateStore(): Promise<void> {
  if (_store) {
    await _store.close();
    _store = null;
  }
}
