import { LifecycleHookRegistry, type HookEvent, type HookPayloadMap } from './hooks/hook-registry';

export interface DomainHookRegistration<E extends HookEvent = HookEvent> {
  event: E;
  handler: (payload: HookPayloadMap[E]) => Promise<void>;
}

export interface DomainManifest {
  name: string;
  version: string;
  /** Lifecycle hooks this domain wants to subscribe to */
  hooks?: DomainHookRegistration[];
  /** Metadata — description, author, etc. */
  meta?: Record<string, unknown>;
}

export interface DomainRegistryDeps {
  hooks: LifecycleHookRegistry;
}

export class DomainRegistry {
  private domains = new Map<string, DomainManifest>();

  constructor(private readonly deps: DomainRegistryDeps) {}

  register(manifest: DomainManifest): void {
    if (this.domains.has(manifest.name)) {
      throw new Error(`Domain "${manifest.name}" is already registered`);
    }

    // Wire hooks
    for (const { event, handler } of manifest.hooks ?? []) {
      this.deps.hooks.on(event, handler as (payload: HookPayloadMap[HookEvent]) => Promise<void>);
    }

    this.domains.set(manifest.name, manifest);

    // Notify — fire-and-forget (don't block registration)
    this.deps.hooks.emit('domain_registered', {
      domainName: manifest.name,
      workspaceId: 'system',
    }).catch(() => {/* ignore hook errors during registration */});
  }

  isRegistered(name: string): boolean {
    return this.domains.has(name);
  }

  listDomains(): string[] {
    return [...this.domains.keys()];
  }

  getManifest(name: string): DomainManifest | undefined {
    return this.domains.get(name);
  }
}
