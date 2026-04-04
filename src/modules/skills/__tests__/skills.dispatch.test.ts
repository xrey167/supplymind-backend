import { describe, test, expect, beforeEach } from 'bun:test';
import { dispatchSkill } from '../skills.dispatch';
import { skillRegistry } from '../skills.registry';
import { skillCache } from '../skills.cache';
import { ok, err } from '../../../core/result';
import type { DispatchContext } from '../skills.types';

const ctx: DispatchContext = {
  callerId: 'test-user',
  workspaceId: 'ws-1',
  callerRole: 'admin',
};

describe('dispatchSkill', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
  });

  test('returns error for unknown skill', async () => {
    const result = await dispatchSkill('nope', {}, ctx);
    expect(result.ok).toBe(false);
  });

  test('dispatches to registered skill and returns result', async () => {
    skillRegistry.register({
      id: 'test:echo',
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => ok(args),
    });
    const result = await dispatchSkill('echo', { msg: 'hi' }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ msg: 'hi' });
  });

  test('caches results on second call', async () => {
    let callCount = 0;
    skillRegistry.register({
      id: 'test:counter',
      name: 'counter',
      description: 'Counts',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async () => { callCount++; return ok(callCount); },
    });

    await dispatchSkill('counter', { key: 1 }, ctx);
    const second = await dispatchSkill('counter', { key: 1 }, ctx);
    // Second call should return cached value (1), not re-invoke (which would be 2)
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value).toBe(1);
    expect(callCount).toBe(1);
  });

  test('passes through failed skill results', async () => {
    skillRegistry.register({
      id: 'test:fail',
      name: 'fail',
      description: 'Fails',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async () => err(new Error('boom')),
    });
    const result = await dispatchSkill('fail', {}, ctx);
    expect(result.ok).toBe(false);
  });
});
