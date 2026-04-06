import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopedMemoryStore } from '../scoped-memory';

describe('ScopedMemoryStore', () => {
  let store: ScopedMemoryStore;

  beforeEach(() => {
    store = new ScopedMemoryStore();
  });

  it('stores and retrieves a user-scoped memory', () => {
    store.set({ scope: 'user', scopeId: 'u_1', key: 'name', value: 'Alice' });
    const entry = store.get('user', 'u_1', 'name');
    expect(entry?.value).toBe('Alice');
  });

  it('stores and retrieves workspace-scoped memory', () => {
    store.set({ scope: 'workspace', scopeId: 'ws_1', key: 'timezone', value: 'UTC' });
    expect(store.get('workspace', 'ws_1', 'timezone')?.value).toBe('UTC');
  });

  it('stores and retrieves global memory', () => {
    store.set({ scope: 'global', scopeId: 'global', key: 'platform', value: 'supplymind' });
    expect(store.get('global', 'global', 'platform')?.value).toBe('supplymind');
  });

  it('different scopes are isolated', () => {
    store.set({ scope: 'user', scopeId: 'u_1', key: 'x', value: 'user-val' });
    store.set({ scope: 'workspace', scopeId: 'u_1', key: 'x', value: 'ws-val' });
    expect(store.get('user', 'u_1', 'x')?.value).toBe('user-val');
    expect(store.get('workspace', 'u_1', 'x')?.value).toBe('ws-val');
  });

  it('returns undefined for expired entries', async () => {
    store.set({ scope: 'user', scopeId: 'u_1', key: 'temp', value: 'gone', ttlMs: 1 });
    await new Promise(r => setTimeout(r, 10));
    expect(store.get('user', 'u_1', 'temp')).toBeUndefined();
  });

  it('non-expired entries remain accessible', async () => {
    store.set({ scope: 'user', scopeId: 'u_1', key: 'persist', value: 'here', ttlMs: 10_000 });
    await new Promise(r => setTimeout(r, 5));
    expect(store.get('user', 'u_1', 'persist')?.value).toBe('here');
  });

  it('delete removes an entry', () => {
    store.set({ scope: 'user', scopeId: 'u_1', key: 'del', value: 'bye' });
    store.delete('user', 'u_1', 'del');
    expect(store.get('user', 'u_1', 'del')).toBeUndefined();
  });

  it('listScope returns all non-expired entries for a scope', () => {
    store.set({ scope: 'workspace', scopeId: 'ws_1', key: 'a', value: '1' });
    store.set({ scope: 'workspace', scopeId: 'ws_1', key: 'b', value: '2' });
    const entries = store.listScope('workspace', 'ws_1');
    expect(entries.length).toBe(2);
  });

  it('consent hook can block a set operation', () => {
    const store2 = new ScopedMemoryStore({
      consentCheck: (scope) => scope !== 'user',
    });
    store2.set({ scope: 'user', scopeId: 'u_1', key: 'blocked', value: 'nope' });
    expect(store2.get('user', 'u_1', 'blocked')).toBeUndefined();
    store2.set({ scope: 'workspace', scopeId: 'ws_1', key: 'allowed', value: 'yes' });
    expect(store2.get('workspace', 'ws_1', 'allowed')?.value).toBe('yes');
  });
});
