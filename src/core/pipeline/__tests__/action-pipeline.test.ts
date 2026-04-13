import { describe, it, expect } from 'bun:test';
import { ActionPipeline, ActionBlockedError, type Action } from '../action-pipeline';

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'act-1',
    type: 'test.action',
    payload: { value: 42 },
    workspaceId: 'ws-1',
    priority: 'normal',
    ...overrides,
  };
}

describe('ActionPipeline.execute', () => {
  it('calls handler and returns result', async () => {
    const pipeline = new ActionPipeline();
    const result = await pipeline.execute(makeAction(), async (a) => ({ done: true, from: a.type }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ done: true, from: 'test.action' });
  });

  it('runs pre-hooks before handler', async () => {
    const order: string[] = [];
    const pipeline = new ActionPipeline();
    pipeline.addPreHook({ name: 'pre1', handler: async () => { order.push('pre1'); } });
    await pipeline.execute(makeAction(), async () => { order.push('handler'); return 'done'; });
    expect(order).toEqual(['pre1', 'handler']);
  });

  it('runs post-hooks after handler', async () => {
    const order: string[] = [];
    const pipeline = new ActionPipeline();
    pipeline.addPostHook({ name: 'post1', handler: async () => { order.push('post1'); } });
    await pipeline.execute(makeAction(), async () => { order.push('handler'); return 'done'; });
    expect(order).toEqual(['handler', 'post1']);
  });

  it('pre-hook can block execution', async () => {
    const pipeline = new ActionPipeline();
    let handlerCalled = false;
    let postHookCalled = false;
    pipeline.addPreHook({ name: 'blocker', handler: async () => ({ block: true as const, reason: 'not allowed' }) });
    pipeline.addPostHook({ name: 'post', handler: async () => { postHookCalled = true; } });

    const result = await pipeline.execute(makeAction(), async () => { handlerCalled = true; return 'done'; });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(ActionBlockedError);
    expect(handlerCalled).toBe(false);
    expect(postHookCalled).toBe(false);
  });

  it('pre-hook error propagates as failed result', async () => {
    const pipeline = new ActionPipeline();
    pipeline.addPreHook({ name: 'boom', handler: async () => { throw new Error('hook crashed'); } });
    const result = await pipeline.execute(makeAction(), async () => 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('hook crashed');
  });

  it('handler error propagates as failed result', async () => {
    const pipeline = new ActionPipeline();
    const result = await pipeline.execute(makeAction(), async () => { throw new Error('handler boom'); });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('handler boom');
  });

  it('post-hook receives action and handler result', async () => {
    const pipeline = new ActionPipeline();
    let captured: unknown;
    pipeline.addPostHook({
      name: 'capture',
      handler: async (_action, handlerResult) => { captured = handlerResult; },
    });
    await pipeline.execute(makeAction(), async () => ({ output: 99 }));
    expect(captured).toEqual({ output: 99 });
  });
});

describe('ActionPipeline idempotency', () => {
  it('returns cached result for duplicate idempotencyKey', async () => {
    const pipeline = new ActionPipeline();
    let callCount = 0;
    const handler = async () => { callCount++; return `call-${callCount}`; };
    const action = makeAction({ idempotencyKey: 'key-abc' });
    const r1 = await pipeline.execute(action, handler);
    const r2 = await pipeline.execute(action, handler);
    expect(callCount).toBe(1);
    expect(r1).toEqual(r2);
    if (r1.ok && r2.ok) expect(r1.value).toBe('call-1');
  });

  it('different idempotencyKeys execute independently', async () => {
    const pipeline = new ActionPipeline();
    let callCount = 0;
    const handler = async () => { callCount++; return callCount; };
    await pipeline.execute(makeAction({ idempotencyKey: 'k1' }), handler);
    await pipeline.execute(makeAction({ idempotencyKey: 'k2' }), handler);
    expect(callCount).toBe(2);
  });
});

describe('ActionPipeline.executeBatch', () => {
  it('executes all actions and returns results array', async () => {
    const pipeline = new ActionPipeline();
    const actions = [makeAction({ id: 'a1' }), makeAction({ id: 'a2' })];
    const results = await pipeline.executeBatch(actions, async (a) => a.id);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
  });

  it('sorts high-priority actions before normal before low', async () => {
    const pipeline = new ActionPipeline();
    const order: string[] = [];
    const actions: Action[] = [
      makeAction({ id: 'low', priority: 'low' }),
      makeAction({ id: 'high', priority: 'high' }),
      makeAction({ id: 'normal', priority: 'normal' }),
    ];
    await pipeline.executeBatch(actions, async (a) => { order.push(a.id); return a.id; });
    expect(order).toEqual(['high', 'normal', 'low']);
  });

  it('collects both ok and failed results without stopping', async () => {
    const pipeline = new ActionPipeline();
    const actions = [makeAction({ id: 'a1' }), makeAction({ id: 'a2' })];
    const results = await pipeline.executeBatch(actions, async (a) => {
      if (a.id === 'a1') throw new Error('fail a1');
      return 'ok';
    });
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
  });
});
