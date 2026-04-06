export type MemoryScope = 'user' | 'workspace' | 'global';
export type ScopedMemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  type: ScopedMemoryType;
  name: string;
  body: string;
  createdAt: number;
  userId?: string;
  workspaceId?: string;
}

export interface SaveMemoryInput {
  scope: MemoryScope;
  type: ScopedMemoryType;
  name: string;
  body: string;
  userId?: string;
  workspaceId?: string;
}

export interface RecallFilter {
  scope: MemoryScope;
  userId?: string;
  workspaceId?: string;
  type?: ScopedMemoryType;
}

export interface ForgetFilter {
  scope: MemoryScope;
  name: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * In-memory scoped memory store.
 * In production, back this with a DB table (see memory module's existing Drizzle schema).
 *
 * Three scopes:
 *   user      — personal memories, visible only to that user across all workspaces
 *   workspace — shared memories for a workspace team
 *   global    — platform-wide facts (registered at startup)
 */
export class ScopedMemoryStore {
  private entries: MemoryEntry[] = [];

  save(input: SaveMemoryInput): string {
    const id = Math.random().toString(36).slice(2);
    this.entries.push({ ...input, id, createdAt: Date.now() });
    return id;
  }

  recall(filter: RecallFilter): MemoryEntry[] {
    return this.entries.filter(e => {
      if (e.scope !== filter.scope) return false;
      if (filter.type && e.type !== filter.type) return false;
      if (filter.scope === 'user' && e.userId !== filter.userId) return false;
      if (filter.scope === 'workspace' && e.workspaceId !== filter.workspaceId) return false;
      return true;
    });
  }

  forget(filter: ForgetFilter): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => {
      if (e.scope !== filter.scope || e.name !== filter.name) return true;
      if (filter.scope === 'user' && e.userId !== filter.userId) return true;
      if (filter.scope === 'workspace' && e.workspaceId !== filter.workspaceId) return true;
      return false;
    });
    return this.entries.length < before;
  }
}
