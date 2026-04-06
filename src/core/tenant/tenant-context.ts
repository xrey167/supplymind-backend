import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  workspaceId: string;
  userId: string;
  role: 'admin' | 'member' | 'viewer' | 'billing';
  /** Optional: set when a super-admin is impersonating a workspace member */
  impersonatedBy?: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function withTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}

export function getCurrentTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireCurrentTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('No tenant context — wrap call in withTenant()');
  return ctx;
}
