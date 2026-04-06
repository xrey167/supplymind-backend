export interface ToolMeta {
  description: string;
  category?: string;
  tags?: string[];
}

interface ToolEntry {
  deferred: boolean;
  meta: ToolMeta;
}

export class ToolSearchRegistry {
  private tools = new Map<string, ToolEntry>();

  registerDeferred(name: string, meta: ToolMeta): void {
    this.tools.set(name, { deferred: true, meta });
  }

  registerEager(name: string, meta: ToolMeta): void {
    this.tools.set(name, { deferred: false, meta });
  }

  shouldDefer(name: string): boolean {
    return this.tools.get(name)?.deferred ?? false;
  }

  getDeferredTools(): string[] {
    return [...this.tools.entries()]
      .filter(([, e]) => e.deferred)
      .map(([name]) => name);
  }

  listAll(): string[] {
    return [...this.tools.keys()];
  }

  getMetadata(name: string): ToolMeta | undefined {
    return this.tools.get(name)?.meta;
  }
}
