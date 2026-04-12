import { describe, it, expect, beforeEach } from 'bun:test';
import { DomainRegistry, type DomainManifest } from '../domain-registry';
import { LifecycleHookRegistry } from '../hooks/hook-registry';

describe('DomainRegistry', () => {
  let hooks: LifecycleHookRegistry;
  let registry: DomainRegistry;

  beforeEach(() => {
    hooks = new LifecycleHookRegistry();
    registry = new DomainRegistry({ hooks });
  });

  it('registers a domain and returns it by name', () => {
    const manifest: DomainManifest = {
      name: 'inventory',
      version: '1.0.0',
    };
    registry.register(manifest);
    expect(registry.isRegistered('inventory')).toBe(true);
  });

  it('returns false for unregistered domains', () => {
    expect(registry.isRegistered('billing')).toBe(false);
  });

  it('registers domain hooks into the hook registry', async () => {
    let fired = false;
    const manifest: DomainManifest = {
      name: 'test-domain',
      version: '1.0.0',
      hooks: [
        { event: 'task_created', handler: async () => { fired = true; } },
      ],
    };
    registry.register(manifest);
    await hooks.emit('task_created', { taskId: 'task_1', workspaceId: 'ws-1', agentId: 'agent_1' });
    expect(fired).toBe(true);
  });

  it('lists registered domain names', () => {
    registry.register({ name: 'domain-a', version: '1.0.0' });
    registry.register({ name: 'domain-b', version: '1.0.0' });
    const names = registry.listDomains();
    expect(names).toContain('domain-a');
    expect(names).toContain('domain-b');
  });

  it('throws when registering the same domain twice', () => {
    registry.register({ name: 'dup', version: '1.0.0' });
    expect(() => registry.register({ name: 'dup', version: '1.0.0' })).toThrow();
  });

  it('emits domain_registered hook after registration', async () => {
    let registeredName: string | undefined;
    hooks.on('domain_registered', async (p) => { registeredName = p.domainName; });
    registry.register({ name: 'supply', version: '1.0.0' });
    // Hook fires asynchronously (fire-and-forget)
    await new Promise(r => setTimeout(r, 10));
    expect(registeredName).toBe('supply');
  });
});
