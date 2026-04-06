import { describe, it, expect } from 'bun:test';
import { PermissionPipeline } from '../permission-pipeline';
import type { PermissionContext } from '../types';

const ctx: PermissionContext = { workspaceId: 'w1', callerId: 'u1', toolName: 'bash' };

describe('PermissionPipeline', () => {
  it('allows by default when no layers registered', async () => {
    const pipeline = new PermissionPipeline();
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('allow');
    expect(result.decisionLayer).toBe('default');
  });

  it('deny layer short-circuits immediately', async () => {
    const pipeline = new PermissionPipeline();
    pipeline.addLayer({
      name: 'deny-all',
      async check(_ctx) { return { behavior: 'deny', reason: 'blocked by policy' }; },
    });
    pipeline.addLayer({
      name: 'should-not-run',
      async check(_ctx) { throw new Error('should not reach here'); },
    });
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('deny');
    expect(result.decisionLayer).toBe('deny-all');
    expect(result.reason).toBe('blocked by policy');
  });

  it('passthrough continues to next layer', async () => {
    const pipeline = new PermissionPipeline();
    pipeline.addLayer({ name: 'pass', async check() { return { behavior: 'passthrough' }; } });
    pipeline.addLayer({ name: 'allow', async check() { return { behavior: 'allow' }; } });
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('allow');
    expect(result.decisionLayer).toBe('allow');
  });

  it('ask layer returns ask with message', async () => {
    const pipeline = new PermissionPipeline();
    pipeline.addLayer({
      name: 'ask-layer',
      async check() { return { behavior: 'ask', message: 'Confirm this action?' }; },
    });
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('ask');
    expect(result.message).toBe('Confirm this action?');
  });

  it('removeLayer removes by name', async () => {
    const pipeline = new PermissionPipeline();
    pipeline.addLayer({ name: 'deny-all', async check() { return { behavior: 'deny', reason: 'no' }; } });
    pipeline.removeLayer('deny-all');
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('allow');
  });

  it('addLayer returns this for chaining', () => {
    const pipeline = new PermissionPipeline();
    const result = pipeline.addLayer({ name: 'l', async check() { return { behavior: 'passthrough' }; } });
    expect(result).toBe(pipeline);
  });
});
