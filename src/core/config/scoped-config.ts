/**
 * Scope-based configuration with multi-level precedence.
 *
 * Supports layered config resolution: global → tenant → workspace → user.
 * Later scopes override earlier ones (user wins over workspace, etc.).
 *
 * Plug-and-play: customers set config at any scope level.
 * Multi-tenant: each workspace/tenant gets isolated config.
 */

export type ConfigScope = 'global' | 'tenant' | 'workspace' | 'user';

const SCOPE_PRECEDENCE: ConfigScope[] = ['global', 'tenant', 'workspace', 'user'];

interface ScopedValue<T> {
  value: T;
  scope: ConfigScope;
  setBy?: string;
  setAt: number;
}

interface ScopeKey {
  scope: ConfigScope;
  scopeId: string;
}

function toKey(sk: ScopeKey, configKey: string): string {
  return `${sk.scope}:${sk.scopeId}:${configKey}`;
}

export class ScopedConfigStore<T = unknown> {
  private store = new Map<string, ScopedValue<T>>();

  /**
   * Set a config value at a specific scope.
   */
  set(scope: ConfigScope, scopeId: string, key: string, value: T, setBy?: string): void {
    this.store.set(toKey({ scope, scopeId }, key), {
      value,
      scope,
      setBy,
      setAt: Date.now(),
    });
  }

  /**
   * Resolve a config value using scope precedence.
   * Pass all applicable scope IDs; the highest-precedence match wins.
   */
  resolve(key: string, scopes: Partial<Record<ConfigScope, string>>): T | undefined {
    // Walk from highest precedence to lowest
    for (let i = SCOPE_PRECEDENCE.length - 1; i >= 0; i--) {
      const scope = SCOPE_PRECEDENCE[i];
      const scopeId = scopes[scope];
      if (!scopeId) continue;
      const entry = this.store.get(toKey({ scope, scopeId }, key));
      if (entry !== undefined) return entry.value;
    }
    return undefined;
  }

  /**
   * Resolve with full metadata (which scope provided the value).
   */
  resolveWithMeta(key: string, scopes: Partial<Record<ConfigScope, string>>): ScopedValue<T> | undefined {
    for (let i = SCOPE_PRECEDENCE.length - 1; i >= 0; i--) {
      const scope = SCOPE_PRECEDENCE[i];
      const scopeId = scopes[scope];
      if (!scopeId) continue;
      const entry = this.store.get(toKey({ scope, scopeId }, key));
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  /**
   * Get all values for a key across all scopes (for debugging/admin).
   */
  getAll(key: string, scopes: Partial<Record<ConfigScope, string>>): Array<ScopedValue<T> & { scopeId: string }> {
    const result: Array<ScopedValue<T> & { scopeId: string }> = [];
    for (const scope of SCOPE_PRECEDENCE) {
      const scopeId = scopes[scope];
      if (!scopeId) continue;
      const entry = this.store.get(toKey({ scope, scopeId }, key));
      if (entry) result.push({ ...entry, scopeId });
    }
    return result;
  }

  /**
   * Delete a config value at a specific scope.
   */
  delete(scope: ConfigScope, scopeId: string, key: string): boolean {
    return this.store.delete(toKey({ scope, scopeId }, key));
  }

  /**
   * Clear all config for a scope (e.g., when a workspace is deleted).
   */
  clearScope(scope: ConfigScope, scopeId: string): void {
    const prefix = `${scope}:${scopeId}:`;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  /** Clear everything (tests). */
  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Singleton for general-purpose scoped config. */
export const scopedConfig = new ScopedConfigStore();
