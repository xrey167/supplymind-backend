import { describe, test, expect, beforeEach } from 'bun:test';
import { toolRegistry } from '../tools.registry';
import { skillRegistry } from '../../skills/skills.registry';
import { hooksRegistry } from '../tools.hooks';
import { ok } from '../../../core/result';
import type { RegisteredTool, ToolPlugin } from '../tools.registry';

const makeTool = (overrides?: Partial<RegisteredTool>): RegisteredTool => ({
  id: 'tool-1',
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: { type: 'object' },
  source: 'builtin',
  priority: 10,
  enabled: true,
  handler: async () => ok('result'),
  ...overrides,
});

describe('ToolRegistry', () => {
  beforeEach(() => {
    toolRegistry.clear();
    skillRegistry.clear();
  });

  test('register adds tool and syncs to skill registry', () => {
    toolRegistry.register(makeTool());
    expect(toolRegistry.has('test_tool')).toBe(true);
    expect(skillRegistry.has('test_tool')).toBe(true);
  });

  test('register skips lower priority tool', () => {
    toolRegistry.register(makeTool({ priority: 20 }));
    toolRegistry.register(makeTool({ id: 'tool-2', priority: 10 }));
    expect(toolRegistry.get('test_tool')?.id).toBe('tool-1');
  });

  test('register replaces lower priority with higher', () => {
    toolRegistry.register(makeTool({ priority: 10 }));
    toolRegistry.register(makeTool({ id: 'tool-2', priority: 20 }));
    expect(toolRegistry.get('test_tool')?.id).toBe('tool-2');
  });

  test('disabled tool does not sync to skill registry', () => {
    toolRegistry.register(makeTool({ enabled: false }));
    expect(toolRegistry.has('test_tool')).toBe(true);
    expect(skillRegistry.has('test_tool')).toBe(false);
  });

  test('enable syncs to skill registry', () => {
    toolRegistry.register(makeTool({ enabled: false }));
    expect(skillRegistry.has('test_tool')).toBe(false);
    toolRegistry.enable('test_tool');
    expect(skillRegistry.has('test_tool')).toBe(true);
  });

  test('disable removes from skill registry', () => {
    toolRegistry.register(makeTool());
    expect(skillRegistry.has('test_tool')).toBe(true);
    toolRegistry.disable('test_tool');
    expect(skillRegistry.has('test_tool')).toBe(false);
  });

  test('unregister removes from both registries', () => {
    toolRegistry.register(makeTool());
    toolRegistry.unregister('test_tool');
    expect(toolRegistry.has('test_tool')).toBe(false);
    expect(skillRegistry.has('test_tool')).toBe(false);
  });

  test('list filters by source', () => {
    toolRegistry.register(makeTool({ name: 'a', source: 'builtin' }));
    toolRegistry.register(makeTool({ id: 'tool-2', name: 'b', source: 'plugin', pluginId: 'p1' }));
    expect(toolRegistry.list({ source: 'builtin' })).toHaveLength(1);
    expect(toolRegistry.list({ source: 'plugin' })).toHaveLength(1);
  });

  test('list filters by pluginId', () => {
    toolRegistry.register(makeTool({ name: 'a', source: 'plugin', pluginId: 'p1' }));
    toolRegistry.register(makeTool({ id: 'tool-2', name: 'b', source: 'plugin', pluginId: 'p2' }));
    expect(toolRegistry.list({ pluginId: 'p1' })).toHaveLength(1);
  });

  test('registerPlugin loads and registers plugin tools', async () => {
    const plugin: ToolPlugin = {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      loadTools: async () => [
        { id: 'pt-1', name: 'plugin_tool_a', description: 'A', inputSchema: {}, priority: 30, enabled: true, handler: async () => ok('a') },
        { id: 'pt-2', name: 'plugin_tool_b', description: 'B', inputSchema: {}, priority: 30, enabled: true, handler: async () => ok('b') },
      ],
    };

    await toolRegistry.registerPlugin(plugin);

    expect(toolRegistry.list({ pluginId: 'test-plugin' })).toHaveLength(2);
    expect(skillRegistry.has('plugin_tool_a')).toBe(true);
    expect(skillRegistry.has('plugin_tool_b')).toBe(true);
    expect(toolRegistry.listPlugins()).toHaveLength(1);
  });

  test('unregisterPlugin removes all plugin tools', async () => {
    const plugin: ToolPlugin = {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      loadTools: async () => [
        { id: 'pt-1', name: 'plugin_tool_a', description: 'A', inputSchema: {}, priority: 30, enabled: true, handler: async () => ok('a') },
      ],
    };

    await toolRegistry.registerPlugin(plugin);
    expect(toolRegistry.has('plugin_tool_a')).toBe(true);

    toolRegistry.unregisterPlugin('test-plugin');
    expect(toolRegistry.has('plugin_tool_a')).toBe(false);
    expect(skillRegistry.has('plugin_tool_a')).toBe(false);
    expect(toolRegistry.listPlugins()).toHaveLength(0);
  });

  test('clear removes all tools and plugins', async () => {
    toolRegistry.register(makeTool());
    const plugin: ToolPlugin = {
      id: 'p1', name: 'P', version: '1.0.0',
      loadTools: async () => [{ id: 'pt-1', name: 'pt', description: 'X', inputSchema: {}, priority: 30, enabled: true, handler: async () => ok('x') }],
    };
    await toolRegistry.registerPlugin(plugin);

    toolRegistry.clear();
    expect(toolRegistry.list()).toHaveLength(0);
    expect(toolRegistry.listPlugins()).toHaveLength(0);
  });

  test('toolHints flow through to skill registry', () => {
    toolRegistry.register(makeTool({ toolHints: { strict: true, cacheable: true } }));
    const skill = skillRegistry.get('test_tool');
    expect(skill?.toolHints?.strict).toBe(true);
    expect(skill?.toolHints?.cacheable).toBe(true);
  });

  test('stale hooks cleared when tool re-registered without hooks', () => {
    const beforeHook = async () => ({ allow: true });

    // Register tool WITH a beforeExecute hook
    toolRegistry.register(makeTool({
      priority: 10,
      beforeExecute: beforeHook,
    }));

    expect(hooksRegistry.get('test_tool')).toBeDefined();
    expect(hooksRegistry.get('test_tool')?.beforeExecute).toBe(beforeHook);

    // Re-register the same tool name at higher priority WITHOUT any hooks
    toolRegistry.register(makeTool({
      id: 'tool-2',
      priority: 20,
      beforeExecute: undefined,
      afterExecute: undefined,
    }));

    // Verify stale hooks are cleared
    expect(hooksRegistry.get('test_tool')).toBeUndefined();
  });
});
