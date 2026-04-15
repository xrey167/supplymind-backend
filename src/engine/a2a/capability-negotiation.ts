// Capability negotiation — in-memory SemVer + load-aware skill routing.
// Capabilities are volatile (agents re-register on connect), no DB persistence needed.

interface AgentCapability {
  skillId: string;
  agentUrl: string;
  version: string;           // SemVer e.g. "2.1.0"
  features: string[];        // e.g. ['streaming', 'vision']
  maxConcurrency: number;    // max parallel calls this agent handles
  activeCalls: number;       // current active calls (tracked locally)
  priority: number;          // higher = preferred (default 0)
  successCount: number;
  failureCount: number;
  lastFailureAt?: number;    // epoch ms
}

interface RegisterOptions {
  version?: string;
  features?: string[];
  maxConcurrency?: number;
  priority?: number;
}

interface NegotiateOptions {
  minVersion?: string;         // e.g. "2.0.0" — requires capability.version >= this
  requiredFeatures?: string[]; // all must be present
}

// Inline SemVer comparison — no external dependency
function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map(n => parseInt(n, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function semverGte(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat >= bPat;
}

const FAILURE_COOLDOWN_MS = 30_000; // 30 seconds

class CapabilityRegistry {
  // Map: `${skillId}::${agentUrl}` → AgentCapability
  private caps = new Map<string, AgentCapability>();

  private key(skillId: string, agentUrl: string): string {
    return `${skillId}::${agentUrl}`;
  }

  register(skillId: string, agentUrl: string, opts: RegisterOptions = {}): void {
    const key = this.key(skillId, agentUrl);
    const existing = this.caps.get(key);
    this.caps.set(key, {
      skillId,
      agentUrl,
      version: opts.version ?? '1.0.0',
      features: opts.features ?? [],
      maxConcurrency: opts.maxConcurrency ?? 10,
      activeCalls: existing?.activeCalls ?? 0,
      priority: opts.priority ?? 0,
      successCount: existing?.successCount ?? 0,
      failureCount: existing?.failureCount ?? 0,
      lastFailureAt: existing?.lastFailureAt,
    });
  }

  deregisterAgent(agentUrl: string): void {
    for (const [key, cap] of this.caps) {
      if (cap.agentUrl === agentUrl) this.caps.delete(key);
    }
  }

  negotiate(skillId: string, opts?: NegotiateOptions): AgentCapability | null {
    const candidates: AgentCapability[] = [];

    for (const cap of this.caps.values()) {
      if (cap.skillId !== skillId) continue;

      // Version filter
      if (opts?.minVersion && !semverGte(cap.version, opts.minVersion)) continue;

      // Feature filter
      if (opts?.requiredFeatures?.length) {
        const hasAll = opts.requiredFeatures.every(f => cap.features.includes(f));
        if (!hasAll) continue;
      }

      // Skip recently failed (cooldown)
      if (cap.lastFailureAt && Date.now() - cap.lastFailureAt < FAILURE_COOLDOWN_MS) continue;

      candidates.push(cap);
    }

    if (candidates.length === 0) return null;

    // Sort: priority DESC, load ratio ASC (activeCalls/maxConcurrency), failureRate ASC
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      const aLoad = a.activeCalls / Math.max(a.maxConcurrency, 1);
      const bLoad = b.activeCalls / Math.max(b.maxConcurrency, 1);
      if (Math.abs(aLoad - bLoad) > 0.01) return aLoad - bLoad;
      const aFailRate = a.failureCount / Math.max(a.successCount + a.failureCount, 1);
      const bFailRate = b.failureCount / Math.max(b.successCount + b.failureCount, 1);
      return aFailRate - bFailRate;
    });

    return candidates[0] ?? null;
  }

  recordStart(skillId: string, agentUrl: string): void {
    const cap = this.caps.get(this.key(skillId, agentUrl));
    if (cap) cap.activeCalls++;
  }

  recordSuccess(skillId: string, agentUrl: string): void {
    const cap = this.caps.get(this.key(skillId, agentUrl));
    if (cap) {
      cap.activeCalls = Math.max(0, cap.activeCalls - 1);
      cap.successCount++;
    }
  }

  recordFailure(skillId: string, agentUrl: string): void {
    const cap = this.caps.get(this.key(skillId, agentUrl));
    if (cap) {
      cap.activeCalls = Math.max(0, cap.activeCalls - 1);
      cap.failureCount++;
      cap.lastFailureAt = Date.now();
    }
  }

  /** List all capabilities for a skill (for debugging/admin) */
  listForSkill(skillId: string): AgentCapability[] {
    return Array.from(this.caps.values()).filter(c => c.skillId === skillId);
  }

  /** Total registered capabilities */
  size(): number {
    return this.caps.size;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
export type { AgentCapability, RegisterOptions, NegotiateOptions };
