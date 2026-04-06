export type MemoryScope = 'user' | 'workspace' | 'global';

export interface MemoryEntry {
  scope: MemoryScope;
  scopeId: string;
  key: string;
  value: unknown;
  /** If set, entry expires after this many ms from creation */
  ttlMs?: number;
  createdAt: Date;
  expiresAt?: Date;
}

export type SetInput = Omit<MemoryEntry, 'createdAt' | 'expiresAt'>;

export interface ScopedMemoryStoreOptions {
  /** Return false to block a set operation for the given scope */
  consentCheck?: (scope: MemoryScope) => boolean;
}

export class ScopedMemoryStore {
  private store = new Map<string, MemoryEntry>();
  private readonly consentCheck?: (scope: MemoryScope) => boolean;

  constructor(opts?: ScopedMemoryStoreOptions) {
    this.consentCheck = opts?.consentCheck;
  }

  private key(scope: MemoryScope, scopeId: string, key: string): string {
    return `${scope}:${scopeId}:${key}`;
  }

  set(input: SetInput): void {
    if (this.consentCheck && !this.consentCheck(input.scope)) return;
    const now = new Date();
    const entry: MemoryEntry = {
      ...input,
      createdAt: now,
      expiresAt: input.ttlMs !== undefined ? new Date(now.getTime() + input.ttlMs) : undefined,
    };
    this.store.set(this.key(input.scope, input.scopeId, input.key), entry);
  }

  get(scope: MemoryScope, scopeId: string, key: string): MemoryEntry | undefined {
    const entry = this.store.get(this.key(scope, scopeId, key));
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= new Date()) {
      this.store.delete(this.key(scope, scopeId, key));
      return undefined;
    }
    return entry;
  }

  delete(scope: MemoryScope, scopeId: string, key: string): void {
    this.store.delete(this.key(scope, scopeId, key));
  }

  listScope(scope: MemoryScope, scopeId: string): MemoryEntry[] {
    const prefix = `${scope}:${scopeId}:`;
    const now = new Date();
    const results: MemoryEntry[] = [];
    for (const [k, entry] of this.store) {
      if (!k.startsWith(prefix)) continue;
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.store.delete(k);
        continue;
      }
      results.push(entry);
    }
    return results;
  }
}
