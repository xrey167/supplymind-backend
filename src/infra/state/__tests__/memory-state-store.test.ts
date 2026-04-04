import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryStateStore } from '../memory-state-store';
import type { StateStore } from '../types';

describe('MemoryStateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new MemoryStateStore();
  });

  afterEach(async () => {
    await store.close();
  });

  test('get returns null for missing key', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  test('set and get round-trip', async () => {
    await store.set('key1', 'value1');
    expect(await store.get('key1')).toBe('value1');
  });

  test('set with TTL expires entry', async () => {
    await store.set('ttl-key', 'val', 50); // 50ms TTL
    expect(await store.get('ttl-key')).toBe('val');
    await new Promise((r) => setTimeout(r, 80));
    expect(await store.get('ttl-key')).toBeNull();
  });

  test('del removes key and returns true', async () => {
    await store.set('del-key', 'val');
    expect(await store.del('del-key')).toBe(true);
    expect(await store.get('del-key')).toBeNull();
  });

  test('del returns false for missing key', async () => {
    expect(await store.del('nope')).toBe(false);
  });

  test('exists returns true/false correctly', async () => {
    await store.set('exists-key', 'val');
    expect(await store.exists('exists-key')).toBe(true);
    expect(await store.exists('nope')).toBe(false);
  });

  test('incr creates and increments atomically', async () => {
    expect(await store.incr('counter')).toBe(1);
    expect(await store.incr('counter')).toBe(2);
    expect(await store.incr('counter')).toBe(3);
  });

  test('expire sets TTL on existing key', async () => {
    await store.set('expire-key', 'val');
    await store.expire('expire-key', 50);
    expect(await store.get('expire-key')).toBe('val');
    await new Promise((r) => setTimeout(r, 80));
    expect(await store.get('expire-key')).toBeNull();
  });

  test('keys returns matching glob patterns', async () => {
    await store.set('user:1', 'a');
    await store.set('user:2', 'b');
    await store.set('session:1', 'c');
    const userKeys = await store.keys('user:*');
    expect(userKeys.sort()).toEqual(['user:1', 'user:2']);
  });

  test('backend returns memory', () => {
    expect(store.backend).toBe('memory');
  });
});
