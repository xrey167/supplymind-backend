import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Stub bullmq Worker so we don't need a real Redis connection
const mockWorkerClose = mock(() => Promise.resolve());
const MockWorker = mock(() => ({ close: mockWorkerClose }));

const _realBullmq = require('bullmq');
mock.module('bullmq', () => ({
  ..._realBullmq,
  Worker: MockWorker,
}));

import {
  PluginContributionRegistry,
  pluginContributionRegistry,
} from '../plugin-contribution-registry';
import type { PluginContributions } from '../plugin-contribution-registry';

const mockPermissionLayer = {
  name: 'test-layer',
  check: async () => ({ behavior: 'passthrough' as const }),
};

const mockWorkerFactory = mock((_conn: any) => new (MockWorker as any)());

describe('PluginContributionRegistry', () => {
  let registry: PluginContributionRegistry;

  beforeEach(() => {
    registry = new PluginContributionRegistry();
    MockWorker.mockClear();
    mockWorkerClose.mockClear();
    mockWorkerFactory.mockClear();
  });

  describe('register + getTopics', () => {
    test('returns empty object when no plugins registered', () => {
      expect(registry.getTopics()).toEqual({});
    });

    test('returns topics from a single plugin', () => {
      registry.register('plugin-a', {
        topics: { FOO: 'foo.bar', BAZ: 'baz.qux' },
      });
      expect(registry.getTopics()).toEqual({ FOO: 'foo.bar', BAZ: 'baz.qux' });
    });

    test('merges topics from multiple plugins', () => {
      registry.register('plugin-a', { topics: { A: 'a.a' } });
      registry.register('plugin-b', { topics: { B: 'b.b' } });
      expect(registry.getTopics()).toEqual({ A: 'a.a', B: 'b.b' });
    });

    test('second register() with same ID overwrites topics', () => {
      registry.register('plugin-a', { topics: { FOO: 'foo.old' } });
      registry.register('plugin-a', { topics: { FOO: 'foo.new' } });
      expect(registry.getTopics()).toEqual({ FOO: 'foo.new' });
    });

    test('ignores plugins with no topics field', () => {
      registry.register('plugin-a', { roles: [] });
      expect(registry.getTopics()).toEqual({});
    });
  });

  describe('getRoles', () => {
    test('returns empty array when no plugins registered', () => {
      expect(registry.getRoles()).toEqual([]);
    });

    test('returns roles from a single plugin', () => {
      const roles = [{ role: 'procurement_manager', privilege: 'operator' as const, allowedToolPrefixes: ['po.'] }];
      registry.register('sc', { roles });
      expect(registry.getRoles()).toEqual(roles);
    });

    test('concatenates roles from multiple plugins', () => {
      registry.register('plugin-a', { roles: [{ role: 'role_a', privilege: 'agent' as const, allowedToolPrefixes: ['a.'] }] });
      registry.register('plugin-b', { roles: [{ role: 'role_b', privilege: 'admin' as const, allowedToolPrefixes: ['b.'] }] });
      const roles = registry.getRoles();
      expect(roles).toHaveLength(2);
      expect(roles.map(r => r.role)).toContain('role_a');
      expect(roles.map(r => r.role)).toContain('role_b');
    });
  });

  describe('getWorkers', () => {
    test('returns empty array when no plugins registered', () => {
      expect(registry.getWorkers()).toEqual([]);
    });

    test('returns worker contributions', () => {
      const workerContrib = { name: 'erp-sync', queueName: 'erp-sync', factory: mockWorkerFactory };
      registry.register('erp-bc', { workers: [workerContrib] });
      expect(registry.getWorkers()).toHaveLength(1);
      expect(registry.getWorkers()[0].name).toBe('erp-sync');
    });
  });

  describe('getPermissionLayers', () => {
    test('returns empty array when no plugins registered', () => {
      expect(registry.getPermissionLayers()).toEqual([]);
    });

    test('returns permission layers from plugins', () => {
      registry.register('sc', { permissionLayers: [mockPermissionLayer] });
      expect(registry.getPermissionLayers()).toHaveLength(1);
      expect(registry.getPermissionLayers()[0].name).toBe('test-layer');
    });
  });

  describe('startWorkers', () => {
    test('calls factory for each worker contribution', () => {
      const factory = mock((_conn: any) => new (MockWorker as any)());
      registry.register('erp-bc', {
        workers: [{ name: 'erp-sync', queueName: 'erp-sync', factory }],
      });
      const mockRedis = {} as any;
      registry.startWorkers(mockRedis);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(mockRedis);
    });

    test('returns array of { worker, name } handles', () => {
      registry.register('plugin-a', {
        workers: [
          { name: 'worker-1', queueName: 'q1', factory: mockWorkerFactory },
          { name: 'worker-2', queueName: 'q2', factory: mockWorkerFactory },
        ],
      });
      const handles = registry.startWorkers({} as any);
      expect(handles).toHaveLength(2);
      expect(handles[0].name).toBe('worker-1');
      expect(handles[1].name).toBe('worker-2');
    });

    test('stores workers for stopWorkers()', async () => {
      registry.register('erp-bc', {
        workers: [{ name: 'erp-sync', queueName: 'erp-sync', factory: mockWorkerFactory }],
      });
      registry.startWorkers({} as any);
      await registry.stopWorkers();
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopWorkers', () => {
    test('calls close() on all active workers', async () => {
      const factory1 = mock((_c: any) => new (MockWorker as any)());
      const factory2 = mock((_c: any) => new (MockWorker as any)());
      registry.register('plugin-a', { workers: [{ name: 'w1', queueName: 'q1', factory: factory1 }] });
      registry.register('plugin-b', { workers: [{ name: 'w2', queueName: 'q2', factory: factory2 }] });
      registry.startWorkers({} as any);
      await registry.stopWorkers();
      expect(mockWorkerClose).toHaveBeenCalledTimes(2);
    });

    test('clears active workers after stop', async () => {
      registry.register('erp-bc', {
        workers: [{ name: 'erp-sync', queueName: 'erp-sync', factory: mockWorkerFactory }],
      });
      registry.startWorkers({} as any);
      await registry.stopWorkers();
      // second stop is a no-op (no workers to close)
      await registry.stopWorkers();
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    test('resets all contributions and active workers', async () => {
      registry.register('plugin-a', { topics: { A: 'a' }, roles: [{ role: 'r', privilege: 'agent' as const, allowedToolPrefixes: [] }] });
      registry.startWorkers({} as any);
      registry.clear();
      expect(registry.getTopics()).toEqual({});
      expect(registry.getRoles()).toEqual([]);
      // Workers cleared — stopWorkers should not close anything
      await registry.stopWorkers();
      expect(mockWorkerClose).not.toHaveBeenCalled();
    });
  });

  describe('global singleton', () => {
    test('pluginContributionRegistry is a PluginContributionRegistry instance', () => {
      expect(pluginContributionRegistry).toBeInstanceOf(PluginContributionRegistry);
    });
  });

  // ---------------------------------------------------------------------------
  // commands (new contribution type)
  // ---------------------------------------------------------------------------

  describe('getCommands', () => {
    test('returns commands from registered plugin', () => {
      registry.register('my-plugin', {
        commands: [
          { name: 'do-thing', description: 'Does a thing', handler: async () => ({ done: true }) },
        ],
      });
      const cmds = registry.getCommands();
      expect(cmds).toHaveLength(1);
      expect(cmds[0].pluginId).toBe('my-plugin');
      expect(cmds[0].command.name).toBe('do-thing');
    });

    test('returns empty array when no commands registered', () => {
      registry.register('my-plugin', { topics: { FOO: 'foo.bar' } });
      expect(registry.getCommands()).toHaveLength(0);
    });

    test('merges commands from multiple plugins', () => {
      registry.register('plugin-a', {
        commands: [{ name: 'cmd-a', description: 'A', handler: async () => 'a' }],
      });
      registry.register('plugin-b', {
        commands: [
          { name: 'cmd-b1', description: 'B1', handler: async () => 'b1' },
          { name: 'cmd-b2', description: 'B2', handler: async () => 'b2' },
        ],
      });
      expect(registry.getCommands()).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // hooks (new contribution type)
  // ---------------------------------------------------------------------------

  describe('getHooks', () => {
    test('returns hooks from registered plugin', () => {
      registry.register('my-plugin', {
        hooks: [
          { name: 'audit-tool-use', event: 'pre_tool_use', handler: async () => ({ allow: true }) },
        ],
      });
      const hooks = registry.getHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0].pluginId).toBe('my-plugin');
      expect(hooks[0].hook.name).toBe('audit-tool-use');
      expect(hooks[0].hook.event).toBe('pre_tool_use');
    });

    test('returns empty array when no hooks registered', () => {
      registry.register('my-plugin', { topics: { FOO: 'foo.bar' } });
      expect(registry.getHooks()).toHaveLength(0);
    });

    test('supports array event on a single hook', () => {
      registry.register('my-plugin', {
        hooks: [
          { name: 'multi-event', event: ['agent_start', 'agent_stop'], handler: async () => {} },
        ],
      });
      const hooks = registry.getHooks();
      expect(hooks).toHaveLength(1);
      expect(Array.isArray(hooks[0].hook.event)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // promptTemplates (new contribution type)
  // ---------------------------------------------------------------------------

  describe('getPromptTemplates', () => {
    test('returns all templates when no pluginId filter', () => {
      registry.register('plugin-a', {
        promptTemplates: [{ name: 'intro', content: 'Hello {{name}}' }],
      });
      registry.register('plugin-b', {
        promptTemplates: [{ name: 'summary', content: 'Summarize {{topic}}' }],
      });
      expect(registry.getPromptTemplates()).toHaveLength(2);
    });

    test('filters by pluginId', () => {
      registry.register('plugin-a', {
        promptTemplates: [{ name: 'intro', content: 'Hello' }],
      });
      registry.register('plugin-b', {
        promptTemplates: [{ name: 'summary', content: 'Summarize' }],
      });
      const result = registry.getPromptTemplates('plugin-a');
      expect(result).toHaveLength(1);
      expect(result[0].pluginId).toBe('plugin-a');
      expect(result[0].template.name).toBe('intro');
    });

    test('returns empty array for unknown pluginId', () => {
      registry.register('plugin-a', {
        promptTemplates: [{ name: 'intro', content: 'Hello' }],
      });
      expect(registry.getPromptTemplates('unknown')).toHaveLength(0);
    });

    test('returns empty when no templates registered', () => {
      registry.register('my-plugin', { topics: { FOO: 'foo.bar' } });
      expect(registry.getPromptTemplates()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // backward compatibility — new types coexist with existing ones
  // ---------------------------------------------------------------------------

  describe('backward compatibility with existing contribution types', () => {
    test('new types coexist alongside existing types without interference', () => {
      registry.register('my-plugin', {
        topics: { SC_TEST: 'sc.test' },
        commands: [{ name: 'test-cmd', description: 'Test', handler: async () => null }],
        promptTemplates: [{ name: 'tpl', content: 'Hello' }],
      });
      expect(registry.getTopics()).toEqual({ SC_TEST: 'sc.test' });
      expect(registry.getCommands()).toHaveLength(1);
      expect(registry.getPromptTemplates()).toHaveLength(1);
      expect(registry.getRoles()).toHaveLength(0);
      expect(registry.getHooks()).toHaveLength(0);
    });
  });
});
