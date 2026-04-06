import { describe, it, expect } from 'bun:test';
import { type TenantContext, withTenant, getCurrentTenant, requireCurrentTenant } from '../tenant-context';

describe('TenantContext', () => {
  it('propagates context through async calls', async () => {
    const ctx: TenantContext = { workspaceId: 'ws_123', userId: 'usr_456', role: 'member' };
    let captured: TenantContext | undefined;
    await withTenant(ctx, async () => {
      captured = getCurrentTenant();
    });
    expect(captured?.workspaceId).toBe('ws_123');
    expect(captured?.userId).toBe('usr_456');
  });

  it('returns undefined outside of tenant context', () => {
    expect(getCurrentTenant()).toBeUndefined();
  });

  it('requireCurrentTenant throws when no context', () => {
    expect(() => requireCurrentTenant()).toThrow('No tenant context');
  });

  it('requireCurrentTenant returns context when set', async () => {
    const ctx: TenantContext = { workspaceId: 'ws_1', userId: 'u_1', role: 'admin' };
    let result: TenantContext | undefined;
    await withTenant(ctx, async () => {
      result = requireCurrentTenant();
    });
    expect(result?.workspaceId).toBe('ws_1');
  });

  it('nested withTenant overrides parent context', async () => {
    const outer: TenantContext = { workspaceId: 'ws_outer', userId: 'u_1', role: 'admin' };
    const inner: TenantContext = { workspaceId: 'ws_inner', userId: 'u_2', role: 'member' };
    let innerCapture: TenantContext | undefined;
    let outerCapture: TenantContext | undefined;
    await withTenant(outer, async () => {
      await withTenant(inner, async () => {
        innerCapture = getCurrentTenant();
      });
      outerCapture = getCurrentTenant();
    });
    expect(innerCapture?.workspaceId).toBe('ws_inner');
    expect(outerCapture?.workspaceId).toBe('ws_outer');
  });
});
