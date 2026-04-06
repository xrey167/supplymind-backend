import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Control repo behavior via shared state (closure pattern)
let repoGetValue: any = undefined;
let repoGetAllValue: Record<string, any> = {};
const repoSetCalls: [string, string, any][] = [];

mock.module('../feature-flags.repo', () => ({
  featureFlagsRepo: {
    get: mock(async () => repoGetValue),
    set: mock(async (wid: string, flag: string, val: any) => { repoSetCalls.push([wid, flag, val]); }),
    getAll: mock(async () => repoGetAllValue),
  },
}));

// Cache backed by a simple map
const store = new Map<string, any>();
mock.module('../../../infra/cache', () => ({
  getCacheProvider: () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, val: any) => { store.set(key, val); },
    clear: async (prefix: string) => {
      for (const k of [...store.keys()]) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    },
  }),
}));

mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { featureFlagsService } = await import('../feature-flags.service');

beforeEach(() => {
  repoGetValue = undefined;
  repoGetAllValue = {};
  repoSetCalls.length = 0;
  store.clear();
});

describe('featureFlagsService', () => {
  it('returns DEFAULT_FLAGS value when no DB override', async () => {
    repoGetValue = undefined;
    const val = await featureFlagsService.isEnabled('ws-1', 'computer-use.enabled');
    expect(val).toBe(false); // default is false
  });

  it('returns DB override when present', async () => {
    repoGetValue = true;
    const val = await featureFlagsService.isEnabled('ws-1', 'computer-use.enabled');
    expect(val).toBe(true);
  });

  it('getAll merges defaults with DB overrides', async () => {
    repoGetAllValue = { 'computer-use.enabled': true };
    const flags = await featureFlagsService.getAll('ws-1');
    expect(flags['computer-use.enabled']).toBe(true);
    expect(flags['agent.max-iterations']).toBe(50); // default preserved
  });

  it('setFlag calls repo.set and invalidates workspace cache prefix', async () => {
    // Pre-populate cache to confirm invalidation
    store.set('ff:ws-1:computer-use.enabled', false);
    store.set('ff:ws-1:__all__', {});

    await featureFlagsService.setFlag('ws-1', 'computer-use.enabled', true);

    expect(repoSetCalls).toHaveLength(1);
    expect(repoSetCalls[0]).toEqual(['ws-1', 'computer-use.enabled', true]);
    // All ff:ws-1: keys should be evicted
    expect(store.has('ff:ws-1:computer-use.enabled')).toBe(false);
    expect(store.has('ff:ws-1:__all__')).toBe(false);
  });
});
