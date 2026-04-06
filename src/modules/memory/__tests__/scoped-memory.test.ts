import { describe, it, expect } from 'bun:test';
import { ScopedMemoryStore } from '../scoped-memory';

describe('ScopedMemoryStore', () => {
  it('stores and retrieves user-scoped memory', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'user', userId: 'u1', type: 'feedback', name: 'pref', body: 'prefers short answers' });
    const results = store.recall({ scope: 'user', userId: 'u1' });
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe('prefers short answers');
  });

  it('workspace scope is isolated per workspace', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'workspace', workspaceId: 'ws1', type: 'project', name: 'context', body: 'team uses React' });
    store.save({ scope: 'workspace', workspaceId: 'ws2', type: 'project', name: 'context', body: 'team uses Vue' });
    expect(store.recall({ scope: 'workspace', workspaceId: 'ws1' })[0].body).toBe('team uses React');
    expect(store.recall({ scope: 'workspace', workspaceId: 'ws2' })[0].body).toBe('team uses Vue');
  });

  it('global scope visible to all', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'global', type: 'reference', name: 'api-docs', body: 'https://docs.example.com' });
    expect(store.recall({ scope: 'global' })).toHaveLength(1);
  });

  it('forgets by name+scope', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'user', userId: 'u1', type: 'feedback', name: 'pref', body: 'original' });
    store.forget({ scope: 'user', userId: 'u1', name: 'pref' });
    expect(store.recall({ scope: 'user', userId: 'u1' })).toHaveLength(0);
  });

  it('filters by type', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'user', userId: 'u1', type: 'feedback', name: 'a', body: 'feedback' });
    store.save({ scope: 'user', userId: 'u1', type: 'reference', name: 'b', body: 'ref' });
    expect(store.recall({ scope: 'user', userId: 'u1', type: 'feedback' })).toHaveLength(1);
  });
});
