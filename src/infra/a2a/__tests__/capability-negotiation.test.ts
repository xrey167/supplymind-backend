import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';

// Import a fresh registry instance per test by re-importing the module — but since the
// module exports a singleton we use register/deregister to isolate tests instead.
import { capabilityRegistry } from '../capability-negotiation';

// ── Helpers ──────────────────────────────────────────────────────────────────

const URL_A = 'http://agent-a:8080';
const URL_B = 'http://agent-b:8080';
const URL_C = 'http://agent-c:8080';
const SKILL = 'summarise';

function registerA(opts = {}) {
  capabilityRegistry.register(SKILL, URL_A, { version: '1.0.0', ...opts });
}

function registerB(opts = {}) {
  capabilityRegistry.register(SKILL, URL_B, { version: '2.0.0', ...opts });
}

// ── Fixture teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Deregister all agents used in tests
  capabilityRegistry.deregisterAgent(URL_A);
  capabilityRegistry.deregisterAgent(URL_B);
  capabilityRegistry.deregisterAgent(URL_C);
});

// ── semverGte (via negotiate filtering) ──────────────────────────────────────

describe('version filtering', () => {
  test('returns agent when version exactly equals minVersion', () => {
    registerA({ version: '2.0.0' });
    const result = capabilityRegistry.negotiate(SKILL, { minVersion: '2.0.0' });
    expect(result).not.toBeNull();
    expect(result?.agentUrl).toBe(URL_A);
  });

  test('returns agent when version is greater than minVersion', () => {
    registerA({ version: '2.1.0' });
    const result = capabilityRegistry.negotiate(SKILL, { minVersion: '2.0.0' });
    expect(result?.agentUrl).toBe(URL_A);
  });

  test('excludes agent when version is less than minVersion (minor)', () => {
    registerA({ version: '1.9.0' });
    const result = capabilityRegistry.negotiate(SKILL, { minVersion: '2.0.0' });
    expect(result).toBeNull();
  });

  test('excludes agent when version is less than minVersion (patch only)', () => {
    registerA({ version: '2.0.0' });
    registerB({ version: '2.0.1' });
    const result = capabilityRegistry.negotiate(SKILL, { minVersion: '2.0.1' });
    expect(result?.agentUrl).toBe(URL_B);
  });

  test('handles major version difference', () => {
    registerA({ version: '1.99.99' });
    const result = capabilityRegistry.negotiate(SKILL, { minVersion: '2.0.0' });
    expect(result).toBeNull();
  });

  test('returns null when no agents registered', () => {
    const result = capabilityRegistry.negotiate(SKILL);
    expect(result).toBeNull();
  });

  test('returns null for unknown skill', () => {
    registerA();
    const result = capabilityRegistry.negotiate('unknown-skill');
    expect(result).toBeNull();
  });
});

// ── Feature filtering ─────────────────────────────────────────────────────────

describe('feature filtering', () => {
  test('returns agent with all required features', () => {
    registerA({ features: ['streaming', 'vision'] });
    const result = capabilityRegistry.negotiate(SKILL, { requiredFeatures: ['streaming'] });
    expect(result?.agentUrl).toBe(URL_A);
  });

  test('excludes agent missing one of multiple required features', () => {
    registerA({ features: ['streaming'] });
    const result = capabilityRegistry.negotiate(SKILL, { requiredFeatures: ['streaming', 'vision'] });
    expect(result).toBeNull();
  });

  test('returns agent when no features required (empty array)', () => {
    registerA({ features: [] });
    const result = capabilityRegistry.negotiate(SKILL, { requiredFeatures: [] });
    expect(result?.agentUrl).toBe(URL_A);
  });

  test('selects agent with required features, skips one without', () => {
    registerA({ features: [] });
    registerB({ features: ['vision'] });
    const result = capabilityRegistry.negotiate(SKILL, { requiredFeatures: ['vision'] });
    expect(result?.agentUrl).toBe(URL_B);
  });
});

// ── Failure cooldown ──────────────────────────────────────────────────────────

describe('failure cooldown', () => {
  let dateSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    dateSpy?.mockRestore();
  });

  test('excludes agent within cooldown window after failure', () => {
    registerA();
    const now = Date.now();
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordFailure(SKILL, URL_A);

    // Mock Date.now to be 10s after failure (within 30s cooldown)
    dateSpy = spyOn(Date, 'now').mockReturnValue(now + 10_000);

    const result = capabilityRegistry.negotiate(SKILL);
    expect(result).toBeNull();
  });

  test('includes agent after cooldown window expires', () => {
    registerA();
    const now = Date.now();
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordFailure(SKILL, URL_A);

    // Mock Date.now to be 31s after failure (past 30s cooldown)
    dateSpy = spyOn(Date, 'now').mockReturnValue(now + 31_000);

    const result = capabilityRegistry.negotiate(SKILL);
    expect(result?.agentUrl).toBe(URL_A);
  });

  test('fallback to second agent while first is in cooldown', () => {
    registerA();
    registerB({ version: '1.0.0' }); // same version as A for fair comparison
    const now = Date.now();
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordFailure(SKILL, URL_A);

    dateSpy = spyOn(Date, 'now').mockReturnValue(now + 5_000);

    const result = capabilityRegistry.negotiate(SKILL);
    expect(result?.agentUrl).toBe(URL_B);
  });
});

// ── Sort: priority ────────────────────────────────────────────────────────────

describe('sorting by priority', () => {
  test('prefers higher priority agent', () => {
    registerA({ priority: 0 });
    registerB({ priority: 10, version: '1.0.0' });
    const result = capabilityRegistry.negotiate(SKILL);
    expect(result?.agentUrl).toBe(URL_B);
  });

  test('negative priority is deprioritised', () => {
    registerA({ priority: -1 });
    registerB({ priority: 0, version: '1.0.0' });
    const result = capabilityRegistry.negotiate(SKILL);
    expect(result?.agentUrl).toBe(URL_B);
  });
});

// ── Sort: load ratio ──────────────────────────────────────────────────────────

describe('sorting by load ratio', () => {
  test('prefers lower load ratio when priority is equal', () => {
    // A: 5/10 = 0.5, B: 2/10 = 0.2 → B wins
    registerA({ priority: 0, maxConcurrency: 10 });
    registerB({ priority: 0, maxConcurrency: 10, version: '1.0.0' });

    // Manually inflate activeCalls
    for (let i = 0; i < 5; i++) {
      capabilityRegistry.recordStart(SKILL, URL_A);
    }
    for (let i = 0; i < 2; i++) {
      capabilityRegistry.recordStart(SKILL, URL_B);
    }

    const result = capabilityRegistry.negotiate(SKILL);
    expect(result?.agentUrl).toBe(URL_B);
  });

  test('maxConcurrency=0 treated as 1 (no divide-by-zero)', () => {
    // Both agents with maxConcurrency=0 and same activeCalls should not throw
    registerA({ priority: 0, maxConcurrency: 0 });
    expect(() => capabilityRegistry.negotiate(SKILL)).not.toThrow();
  });
});

// ── Sort: failure rate ────────────────────────────────────────────────────────

describe('sorting by failure rate (tiebreaker)', () => {
  test('prefers agent with lower failure rate when priority and load are equal', () => {
    registerA({ priority: 0 });
    registerB({ priority: 0, version: '1.0.0' });

    // A has 1 failure, 0 success → rate 1.0
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordFailure(SKILL, URL_A);
    // Immediately re-register to reset cooldown
    registerA({ priority: 0 });
    // A now has failureCount=1, successCount=0 but no lastFailureAt (cleared by re-register? No — re-register preserves counters)
    // We need to mock Date.now so cooldown check passes
    const dateSpy = spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);

    // B has 0 failures
    const result = capabilityRegistry.negotiate(SKILL);
    expect(result?.agentUrl).toBe(URL_B);

    dateSpy.mockRestore();
  });
});

// ── Counter semantics ─────────────────────────────────────────────────────────

describe('counter semantics', () => {
  test('recordStart increments activeCalls', () => {
    registerA();
    capabilityRegistry.recordStart(SKILL, URL_A);
    const caps = capabilityRegistry.listForSkill(SKILL);
    expect(caps[0]?.activeCalls).toBe(1);
  });

  test('recordSuccess decrements activeCalls and increments successCount', () => {
    registerA();
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordSuccess(SKILL, URL_A);
    const caps = capabilityRegistry.listForSkill(SKILL);
    expect(caps[0]?.activeCalls).toBe(0);
    expect(caps[0]?.successCount).toBe(1);
  });

  test('activeCalls does not go below 0 on recordSuccess', () => {
    registerA();
    capabilityRegistry.recordSuccess(SKILL, URL_A); // no prior start
    const caps = capabilityRegistry.listForSkill(SKILL);
    expect(caps[0]?.activeCalls).toBe(0);
  });

  test('recordFailure decrements activeCalls and increments failureCount', () => {
    registerA();
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordFailure(SKILL, URL_A);
    const caps = capabilityRegistry.listForSkill(SKILL);
    expect(caps[0]?.activeCalls).toBe(1);
    expect(caps[0]?.failureCount).toBe(1);
    expect(caps[0]?.lastFailureAt).toBeDefined();
  });

  test('activeCalls does not go below 0 on recordFailure', () => {
    registerA();
    capabilityRegistry.recordFailure(SKILL, URL_A); // no prior start
    const caps = capabilityRegistry.listForSkill(SKILL);
    expect(caps[0]?.activeCalls).toBe(0);
  });

  test('no-op when skillId/agentUrl not found in recordStart', () => {
    expect(() => capabilityRegistry.recordStart('x', 'http://missing')).not.toThrow();
  });
});

// ── Register idempotency ──────────────────────────────────────────────────────

describe('register idempotency', () => {
  test('re-register updates version but preserves successCount and failureCount', () => {
    registerA({ version: '1.0.0' });
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordSuccess(SKILL, URL_A);
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordFailure(SKILL, URL_A);

    // Re-register with new version
    registerA({ version: '1.1.0' });

    const caps = capabilityRegistry.listForSkill(SKILL);
    const cap = caps[0]!;
    expect(cap.version).toBe('1.1.0');
    expect(cap.successCount).toBe(1);
    expect(cap.failureCount).toBe(1);
  });

  test('re-register preserves activeCalls in progress', () => {
    registerA();
    capabilityRegistry.recordStart(SKILL, URL_A);
    capabilityRegistry.recordStart(SKILL, URL_A);
    registerA({ version: '1.1.0' }); // re-register mid-flight
    const caps = capabilityRegistry.listForSkill(SKILL);
    expect(caps[0]?.activeCalls).toBe(2);
  });
});

// ── deregisterAgent ───────────────────────────────────────────────────────────

describe('deregisterAgent', () => {
  test('removes all skills for a given agent', () => {
    capabilityRegistry.register('skill-1', URL_A, {});
    capabilityRegistry.register('skill-2', URL_A, {});
    capabilityRegistry.deregisterAgent(URL_A);
    expect(capabilityRegistry.negotiate('skill-1')).toBeNull();
    expect(capabilityRegistry.negotiate('skill-2')).toBeNull();
  });

  test('does not remove capabilities for other agents', () => {
    capabilityRegistry.register(SKILL, URL_A, {});
    capabilityRegistry.register(SKILL, URL_B, { version: '1.0.0' });
    capabilityRegistry.deregisterAgent(URL_A);
    expect(capabilityRegistry.negotiate(SKILL)?.agentUrl).toBe(URL_B);
  });

  test('no-op for unknown agent URL', () => {
    registerA();
    expect(() => capabilityRegistry.deregisterAgent('http://ghost')).not.toThrow();
    expect(capabilityRegistry.negotiate(SKILL)?.agentUrl).toBe(URL_A);
  });
});

// ── listForSkill + size ───────────────────────────────────────────────────────

describe('listForSkill and size', () => {
  test('listForSkill returns only capabilities for the given skill', () => {
    capabilityRegistry.register('skill-x', URL_A, {});
    capabilityRegistry.register('skill-y', URL_B, {});
    const list = capabilityRegistry.listForSkill('skill-x');
    expect(list).toHaveLength(1);
    expect(list[0]?.agentUrl).toBe(URL_A);

    // cleanup
    capabilityRegistry.deregisterAgent(URL_A);
    capabilityRegistry.deregisterAgent(URL_B);
  });

  test('size reflects total registered capabilities across all skills', () => {
    const before = capabilityRegistry.size();
    capabilityRegistry.register('skill-x', URL_C, {});
    capabilityRegistry.register('skill-y', URL_C, {});
    expect(capabilityRegistry.size()).toBe(before + 2);
    capabilityRegistry.deregisterAgent(URL_C);
    expect(capabilityRegistry.size()).toBe(before);
  });
});
