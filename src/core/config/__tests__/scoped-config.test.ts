import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopedConfigStore } from '../scoped-config';

describe('ScopedConfigStore', () => {
  let store: ScopedConfigStore<string>;

  beforeEach(() => {
    store = new ScopedConfigStore<string>();
  });

  it('returns undefined for missing keys', () => {
    expect(store.resolve('foo', { global: 'g' })).toBeUndefined();
  });

  it('resolves global scope', () => {
    store.set('global', 'g', 'theme', 'dark');
    expect(store.resolve('theme', { global: 'g' })).toBe('dark');
  });

  it('user scope overrides workspace scope', () => {
    store.set('workspace', 'ws-1', 'theme', 'light');
    store.set('user', 'u-1', 'theme', 'dark');
    expect(store.resolve('theme', { workspace: 'ws-1', user: 'u-1' })).toBe('dark');
  });

  it('workspace scope overrides tenant scope', () => {
    store.set('tenant', 't-1', 'limit', '100');
    store.set('workspace', 'ws-1', 'limit', '50');
    expect(store.resolve('limit', { tenant: 't-1', workspace: 'ws-1' })).toBe('50');
  });

  it('falls through to lower scope when higher is not set', () => {
    store.set('global', 'g', 'color', 'blue');
    expect(store.resolve('color', { global: 'g', workspace: 'ws-1', user: 'u-1' })).toBe('blue');
  });

  it('resolveWithMeta returns scope info', () => {
    store.set('workspace', 'ws-1', 'key', 'val', 'admin');
    const meta = store.resolveWithMeta('key', { workspace: 'ws-1' });
    expect(meta?.scope).toBe('workspace');
    expect(meta?.setBy).toBe('admin');
  });

  it('getAll returns all scope values', () => {
    store.set('global', 'g', 'x', 'a');
    store.set('workspace', 'ws-1', 'x', 'b');
    const all = store.getAll('x', { global: 'g', workspace: 'ws-1' });
    expect(all).toHaveLength(2);
  });

  it('delete removes a scoped value', () => {
    store.set('user', 'u-1', 'k', 'v');
    store.delete('user', 'u-1', 'k');
    expect(store.resolve('k', { user: 'u-1' })).toBeUndefined();
  });

  it('clearScope removes all config for a scope', () => {
    store.set('workspace', 'ws-1', 'a', '1');
    store.set('workspace', 'ws-1', 'b', '2');
    store.set('global', 'g', 'a', '0');
    store.clearScope('workspace', 'ws-1');
    expect(store.resolve('a', { global: 'g', workspace: 'ws-1' })).toBe('0');
    expect(store.resolve('b', { workspace: 'ws-1' })).toBeUndefined();
  });
});
