import { describe, it, expect, beforeEach, mock, spyOn, afterAll } from 'bun:test';
import { PluginManager, type PluginManifest } from '../plugin-manifest';
import { skillRegistry } from '../../skills/skills.registry';
import { lifecycleHooks } from '../../../core/hooks/hook-registry';

// Mock only the modules with external dependencies (DB)
mock.module('../../../core/config/scoped-config', () => ({
  scopedConfig: { set: mock(() => {}), delete: mock(() => {}) },
}));

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
}));

// Use spyOn so we don't replace the real registry module for downstream tests
const registerSkillSpy = spyOn(skillRegistry, 'register').mockReturnValue(undefined as any);
const unregisterSkillSpy = spyOn(skillRegistry, 'unregister').mockReturnValue(undefined as any);
const registerHookSpy = spyOn(lifecycleHooks, 'register').mockReturnValue(undefined as any);
const unregisterHookSpy = spyOn(lifecycleHooks, 'unregister').mockReturnValue(undefined as any);

afterAll(() => {
  registerSkillSpy.mockRestore();
  unregisterSkillSpy.mockRestore();
  registerHookSpy.mockRestore();
  unregisterHookSpy.mockRestore();
});

describe('PluginManager', () => {
  let manager: PluginManager;

  const testManifest: PluginManifest = {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    skills: [
      { name: 'echo', description: 'Echo input', handler: async (args) => args },
    ],
    hooks: [
      { event: 'task_created', handler: async () => {} },
    ],
    config: [
      { key: 'maxRetries', description: 'Max retries', defaultValue: 3 },
    ],
  };

  beforeEach(() => {
    manager = new PluginManager();
    registerSkillSpy.mockClear();
    unregisterSkillSpy.mockClear();
    registerHookSpy.mockClear();
    unregisterHookSpy.mockClear();
  });

  it('installs a plugin and returns cleanup', async () => {
    const cleanup = await manager.install(testManifest, 'ws-1');
    expect(typeof cleanup).toBe('function');
    expect(manager.isInstalled('test-plugin', 'ws-1')).toBe(true);
  });

  it('prevents duplicate installation', async () => {
    await manager.install(testManifest, 'ws-1');
    await expect(manager.install(testManifest, 'ws-1')).rejects.toThrow('already installed');
  });

  it('allows same plugin in different workspaces', async () => {
    await manager.install(testManifest, 'ws-1');
    await manager.install(testManifest, 'ws-2');
    expect(manager.isInstalled('test-plugin', 'ws-1')).toBe(true);
    expect(manager.isInstalled('test-plugin', 'ws-2')).toBe(true);
  });

  it('lists plugins for a workspace', async () => {
    await manager.install(testManifest, 'ws-1');
    const list = manager.list('ws-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('test-plugin');
  });

  it('uninstalls a plugin', async () => {
    await manager.install(testManifest, 'ws-1');
    await manager.uninstall('test-plugin', 'ws-1');
    expect(manager.isInstalled('test-plugin', 'ws-1')).toBe(false);
  });

  it('calls onInstall during installation', async () => {
    const onInstall = mock(async () => {});
    await manager.install({ ...testManifest, id: 'with-hook', onInstall }, 'ws-1');
    expect(onInstall).toHaveBeenCalledWith('ws-1');
  });

  it('calls onUninstall during uninstallation', async () => {
    const onUninstall = mock(async () => {});
    await manager.install({ ...testManifest, id: 'with-unhook', onUninstall }, 'ws-1');
    await manager.uninstall('with-unhook', 'ws-1');
    expect(onUninstall).toHaveBeenCalledWith('ws-1');
  });

  it('uninstall is idempotent for missing plugins', async () => {
    await manager.uninstall('nonexistent', 'ws-1');
    // No error
  });
});
