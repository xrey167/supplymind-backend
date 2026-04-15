import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { lifecycleHooks } = await import('../hook-registry');
import type { HookContext } from '../hook-registry';

const ctx: HookContext = { workspaceId: 'ws-1', callerId: 'test' };

describe('LifecycleHookRegistry', () => {
  beforeEach(() => {
    lifecycleHooks.clear();
  });

  describe('register + run', () => {
    it('runs matching hooks and returns allow=true', async () => {
      const handler = mock(async () => {});
      lifecycleHooks.registerGlobal({ id: 'h1', event: 'pre_tool_use', handler });

      const result = await lifecycleHooks.run('pre_tool_use', { name: 'echo' }, ctx);
      expect(result.allow).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not run hooks for different events', async () => {
      const handler = mock(async () => {});
      lifecycleHooks.registerGlobal({ id: 'h2', event: 'post_tool_use', handler });

      await lifecycleHooks.run('pre_tool_use', {}, ctx);
      expect(handler).not.toHaveBeenCalled();
    });

    it('blocks execution when hook returns allow=false', async () => {
      lifecycleHooks.registerGlobal({
        id: 'h3',
        event: 'pre_tool_use',
        handler: async () => ({ allow: false, reason: 'blocked by policy' }),
      });

      const result = await lifecycleHooks.run('pre_tool_use', {}, ctx);
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('blocked by policy');
    });

    it('modifies payload when hook returns modifiedPayload', async () => {
      lifecycleHooks.registerGlobal({
        id: 'h4',
        event: 'pre_tool_use',
        handler: async (_e, payload) => ({
          modifiedPayload: { ...(payload as any), injected: true },
        }),
      });

      const result = await lifecycleHooks.run('pre_tool_use', { name: 'test' }, ctx);
      expect(result.allow).toBe(true);
      expect((result.payload as any).injected).toBe(true);
    });

    it('chains modifications across multiple hooks', async () => {
      lifecycleHooks.registerGlobal({
        id: 'h5a',
        event: 'pre_tool_use',
        handler: async (_e, payload) => ({ modifiedPayload: { ...(payload as any), step1: true } }),
      });
      lifecycleHooks.registerGlobal({
        id: 'h5b',
        event: 'pre_tool_use',
        handler: async (_e, payload) => ({ modifiedPayload: { ...(payload as any), step2: true } }),
      });

      const result = await lifecycleHooks.run('pre_tool_use', {}, ctx);
      expect((result.payload as any).step1).toBe(true);
      expect((result.payload as any).step2).toBe(true);
    });

    it('swallows hook errors without blocking', async () => {
      lifecycleHooks.registerGlobal({
        id: 'h6',
        event: 'pre_tool_use',
        handler: async () => { throw new Error('boom'); },
      });

      const result = await lifecycleHooks.run('pre_tool_use', {}, ctx);
      expect(result.allow).toBe(true);
    });
  });

  describe('workspace-scoped hooks', () => {
    it('workspace hooks only fire for their workspace', async () => {
      const handler = mock(async () => {});
      lifecycleHooks.register('ws-1', { id: 'ws-h1', event: 'task_created', handler });

      await lifecycleHooks.run('task_created', {}, { ...ctx, workspaceId: 'ws-2' });
      expect(handler).not.toHaveBeenCalled();

      await lifecycleHooks.run('task_created', {}, ctx);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('global hooks run before workspace hooks', async () => {
      const order: string[] = [];
      lifecycleHooks.registerGlobal({
        id: 'g1', event: 'task_created',
        handler: async () => { order.push('global'); },
      });
      lifecycleHooks.register('ws-1', {
        id: 'w1', event: 'task_created',
        handler: async () => { order.push('workspace'); },
      });

      await lifecycleHooks.run('task_created', {}, ctx);
      expect(order).toEqual(['global', 'workspace']);
    });
  });

  describe('unregister', () => {
    it('removes a global hook', async () => {
      const handler = mock(async () => {});
      lifecycleHooks.registerGlobal({ id: 'rm-1', event: 'pre_tool_use', handler });

      lifecycleHooks.unregister('rm-1');
      await lifecycleHooks.run('pre_tool_use', {}, ctx);
      expect(handler).not.toHaveBeenCalled();
    });

    it('removes a workspace hook', async () => {
      const handler = mock(async () => {});
      lifecycleHooks.register('ws-1', { id: 'rm-2', event: 'pre_tool_use', handler });

      lifecycleHooks.unregister('rm-2', 'ws-1');
      await lifecycleHooks.run('pre_tool_use', {}, ctx);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('notify (fire-and-forget)', () => {
    it('fires hooks without waiting', () => {
      const handler = mock(async () => {});
      lifecycleHooks.registerGlobal({ id: 'n1', event: 'post_tool_use', handler });

      lifecycleHooks.notify('post_tool_use', { name: 'echo' }, ctx);
      // Handler will be called asynchronously
    });
  });

  describe('list', () => {
    it('lists all hooks for a workspace', () => {
      lifecycleHooks.registerGlobal({ id: 'l1', event: 'pre_tool_use', handler: async () => {}, provider: 'plugin-a' });
      lifecycleHooks.register('ws-1', { id: 'l2', event: 'post_tool_use', handler: async () => {}, provider: 'plugin-b' });

      const hooks = lifecycleHooks.list('ws-1');
      expect(hooks).toHaveLength(2);
      expect(hooks[0].id).toBe('l1');
      expect(hooks[1].id).toBe('l2');
    });
  });

  describe('multi-event registration', () => {
    it('hook fires for any of the registered events', async () => {
      const handler = mock(async () => {});
      lifecycleHooks.registerGlobal({ id: 'me1', event: ['task_created', 'task_completed'], handler });

      await lifecycleHooks.run('task_created', {}, ctx);
      await lifecycleHooks.run('task_completed', {}, ctx);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});

afterAll(() => mock.restore());
