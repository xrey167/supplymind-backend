import { describe, it, expect, beforeEach } from 'bun:test';
import { ToolSearchRegistry } from '../tool-search';

describe('ToolSearchRegistry', () => {
  let registry: ToolSearchRegistry;

  beforeEach(() => {
    registry = new ToolSearchRegistry();
  });

  it('tools are eager by default', () => {
    expect(registry.shouldDefer('my_tool')).toBe(false);
  });

  it('registers a deferred tool', () => {
    registry.registerDeferred('heavy_tool', { description: 'loads lazily' });
    expect(registry.shouldDefer('heavy_tool')).toBe(true);
  });

  it('eager registration overrides deferred', () => {
    registry.registerDeferred('my_tool', { description: 'was deferred' });
    registry.registerEager('my_tool', { description: 'now eager' });
    expect(registry.shouldDefer('my_tool')).toBe(false);
  });

  it('lists all registered tool names', () => {
    registry.registerDeferred('tool_a', { description: 'a' });
    registry.registerEager('tool_b', { description: 'b' });
    const names = registry.listAll();
    expect(names).toContain('tool_a');
    expect(names).toContain('tool_b');
  });

  it('getDeferredTools returns only deferred tools', () => {
    registry.registerDeferred('lazy', { description: 'lazy' });
    registry.registerEager('eager', { description: 'eager' });
    const deferred = registry.getDeferredTools();
    expect(deferred).toContain('lazy');
    expect(deferred).not.toContain('eager');
  });

  it('getMetadata returns registered metadata', () => {
    registry.registerDeferred('my_tool', { description: 'does stuff', category: 'search' });
    const meta = registry.getMetadata('my_tool');
    expect(meta?.description).toBe('does stuff');
    expect(meta?.category).toBe('search');
  });

  it('getMetadata returns undefined for unknown tools', () => {
    expect(registry.getMetadata('unknown')).toBeUndefined();
  });
});
