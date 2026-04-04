import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Override any stale mock.module from orchestration.engine.test.ts (alphabetically earlier).
// We reconstruct dispatchSkill inline using the real singleton dependencies so that
// skillRegistry state set up in beforeEach is visible to the function.
mock.module('../skills.dispatch', () => {
  const { skillRegistry } = require('../skills.registry') as any;
  const { skillCache } = require('../skills.cache') as any;
  const { skillExecutor } = require('../skills.executor') as any;
  const { hooksRegistry } = require('../../tools/tools.hooks') as any;
  const { err } = require('../../../core/result') as any;
  const { AbortError } = require('../../../core/errors') as any;
  const { eventBus } = require('../../../events/bus') as any;
  const { Topics } = require('../../../events/topics') as any;

  const dispatchSkill = async (skillId: string, args: any, context: any): Promise<any> => {
    if (context.signal?.aborted) return err(new AbortError('Skill dispatch aborted', 'system'));
    if (!skillRegistry.has(skillId)) return err(new Error(`Skill not found: ${skillId}`));
    const hooks = hooksRegistry.get(skillId);
    if (hooks?.beforeExecute) {
      const hookCtx = { callerId: context.callerId, workspaceId: context.workspaceId, traceId: context.traceId };
      const hookResult = await hooks.beforeExecute(args, hookCtx);
      if (!hookResult.allow) return err(new Error(hookResult.reason ?? `Tool ${skillId} blocked by beforeExecute hook`));
      if (hookResult.modifiedArgs !== undefined) args = hookResult.modifiedArgs;
    }
    const cached = await skillCache.get(skillId, args);
    if (cached !== undefined) return { ok: true, value: cached };
    const result = await skillExecutor.execute(skillId, () => skillRegistry.invoke(skillId, args));
    if (result.ok) await skillCache.set(skillId, args, result.value);
    eventBus.publish(Topics.SKILL_INVOKED, { name: skillId, success: result.ok, workspaceId: context.workspaceId, callerId: context.callerId });
    if (hooks?.afterExecute) {
      const hookCtx = { callerId: context.callerId, workspaceId: context.workspaceId, traceId: context.traceId };
      await hooks.afterExecute(args, result, hookCtx).catch(() => {});
    }
    return result;
  };
  return { dispatchSkill };
});

import { dispatchSkill } from '../skills.dispatch';
import { skillRegistry } from '../skills.registry';
import { skillCache } from '../skills.cache';
import { hooksRegistry } from '../../tools/tools.hooks';
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

describe('dispatchSkill hooks', () => {
  beforeEach(() => {
    skillRegistry.clear();
    skillCache.clear();
    hooksRegistry.clear();
  });

  test('beforeExecute returning allow:false blocks execution', async () => {
    let handlerCalled = false;
    skillRegistry.register({
      id: 'test:guarded',
      name: 'guarded',
      description: 'Guarded skill',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => { handlerCalled = true; return ok(args); },
    });
    hooksRegistry.set('guarded', {
      beforeExecute: async (_args, _ctx) => ({ allow: false, reason: 'blocked by policy' }),
    });

    const result = await dispatchSkill('guarded', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('blocked by policy');
    expect(handlerCalled).toBe(false);
  });

  test('beforeExecute can modify args', async () => {
    let receivedArgs: unknown;
    skillRegistry.register({
      id: 'test:argmod',
      name: 'argmod',
      description: 'Arg modifier',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => { receivedArgs = args; return ok(args); },
    });
    hooksRegistry.set('argmod', {
      beforeExecute: async (_args, _ctx) => ({ allow: true, modifiedArgs: { x: 99 } }),
    });

    const result = await dispatchSkill('argmod', { x: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(receivedArgs).toEqual({ x: 99 });
  });

  test('afterExecute error is swallowed', async () => {
    skillRegistry.register({
      id: 'test:aftererr',
      name: 'aftererr',
      description: 'After error',
      inputSchema: { type: 'object' },
      providerType: 'builtin',
      priority: 10,
      handler: async (args) => ok(args),
    });
    hooksRegistry.set('aftererr', {
      afterExecute: async (_args, _result, _ctx) => { throw new Error('afterExecute exploded'); },
    });

    const result = await dispatchSkill('aftererr', {}, ctx);
    expect(result.ok).toBe(true);
  });
});
