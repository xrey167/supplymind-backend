import { describe, test, expect } from 'bun:test';
import {
  selectRandom,
  selectStrictRandom,
  selectFillFirst,
  selectLeastUsed,
  selectP2C,
  selectLKGP,
  selectAuto,
} from '../strategies';
import type { ProviderEntry } from '../types';
import type { ProviderHealthMetrics } from '../../health-store';

const providers: ProviderEntry[] = [
  { provider: 'anthropic', model: 'claude-sonnet-4-6', weight: 60, costPer1kTokens: 0.003, capacity: 10 },
  { provider: 'openai',    model: 'gpt-4o-mini',        weight: 40, costPer1kTokens: 0.0015, capacity: 5 },
  { provider: 'google',    model: 'gemini-1.5-flash',    weight: 20, costPer1kTokens: 0.001 },
];

const all = new Set(['anthropic', 'openai', 'google']);

// ── selectRandom ──────────────────────────────────────────────────────────────

describe('selectRandom', () => {
  test('returns a provider from the pool', () => {
    const target = selectRandom(providers);
    expect(['anthropic', 'openai', 'google']).toContain(target?.provider);
  });

  test('never returns excluded providers', () => {
    for (let i = 0; i < 50; i++) {
      const target = selectRandom(providers, new Set(['anthropic']));
      expect(target?.provider).not.toBe('anthropic');
    }
  });

  test('returns null when all excluded', () => {
    expect(selectRandom(providers, all)).toBeNull();
  });

  test('distributes reasonably uniformly over many draws', () => {
    const counts: Record<string, number> = { anthropic: 0, openai: 0, google: 0 };
    for (let i = 0; i < 900; i++) {
      const t = selectRandom(providers);
      if (t) counts[t.provider]++;
    }
    // Each provider should get ~300 ± 150
    for (const c of Object.values(counts)) {
      expect(c).toBeGreaterThan(100);
    }
  });
});

// ── selectStrictRandom ────────────────────────────────────────────────────────

describe('selectStrictRandom', () => {
  test('cycles through all providers before repeating', () => {
    const deck: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const target = selectStrictRandom(providers, new Set(), deck);
      expect(target).not.toBeNull();
      seen.add(target!.provider);
    }
    expect(seen.size).toBe(3); // all 3 seen before repeat
  });

  test('rebuilds deck after exhaustion', () => {
    const deck: string[] = [];
    const firstCycle = new Set<string>();
    for (let i = 0; i < 3; i++) {
      firstCycle.add(selectStrictRandom(providers, new Set(), deck)!.provider);
    }
    const secondCycle = new Set<string>();
    for (let i = 0; i < 3; i++) {
      secondCycle.add(selectStrictRandom(providers, new Set(), deck)!.provider);
    }
    expect(firstCycle.size).toBe(3);
    expect(secondCycle.size).toBe(3);
  });

  test('returns null when all excluded', () => {
    expect(selectStrictRandom(providers, all, [])).toBeNull();
  });
});

// ── selectFillFirst ───────────────────────────────────────────────────────────

describe('selectFillFirst', () => {
  test('returns first provider when under capacity', () => {
    const counts = new Map([['anthropic', 5]]);
    const target = selectFillFirst(providers, new Set(), counts);
    expect(target?.provider).toBe('anthropic');
  });

  test('overflows to next when first is at capacity', () => {
    const counts = new Map([['anthropic', 10]]);
    const target = selectFillFirst(providers, new Set(), counts);
    expect(target?.provider).toBe('openai');
  });

  test('uses last provider when all with capacity are full', () => {
    const counts = new Map([['anthropic', 10], ['openai', 5]]);
    const target = selectFillFirst(providers, new Set(), counts);
    // google has no capacity (infinite) so it gets picked first
    expect(target?.provider).toBe('google');
  });

  test('returns null when all excluded', () => {
    expect(selectFillFirst(providers, all)).toBeNull();
  });
});

// ── selectLeastUsed ───────────────────────────────────────────────────────────

describe('selectLeastUsed', () => {
  test('picks provider with fewest requests', () => {
    const counts = new Map([['anthropic', 50], ['openai', 10], ['google', 30]]);
    const target = selectLeastUsed(providers, new Set(), counts);
    expect(target?.provider).toBe('openai');
  });

  test('picks first provider when all counts equal', () => {
    const counts = new Map([['anthropic', 5], ['openai', 5], ['google', 5]]);
    const target = selectLeastUsed(providers, new Set(), counts);
    expect(target?.provider).toBe('anthropic');
  });

  test('treats missing count as 0', () => {
    const counts = new Map([['anthropic', 10]]);
    const target = selectLeastUsed(providers, new Set(), counts);
    // openai and google have implicit count 0, anthropic has 10
    expect(['openai', 'google']).toContain(target?.provider);
  });

  test('returns null when all excluded', () => {
    expect(selectLeastUsed(providers, all)).toBeNull();
  });
});

// ── selectP2C ─────────────────────────────────────────────────────────────────

function makeHealth(errorRate: number): ProviderHealthMetrics {
  const total = 100;
  const errorCount = Math.round(total * errorRate);
  return {
    errorCount,
    successCount: total - errorCount,
    totalCalls: total,
    errorRate,
    avgLatencyMs: 200,
    lastSuccessAt: Date.now(),
    lastFailureAt: errorCount > 0 ? Date.now() - 1000 : null,
    cooldownUntil: null,
  };
}

describe('selectP2C', () => {
  test('favors lower error rate provider when sampling both', () => {
    const health = new Map([
      ['anthropic', makeHealth(0.8)],
      ['openai', makeHealth(0.1)],
    ]);
    // With only 2 providers, P2C always picks both — should prefer openai
    const counts: Record<string, number> = { anthropic: 0, openai: 0 };
    for (let i = 0; i < 100; i++) {
      const t = selectP2C(providers.slice(0, 2), new Set(), health);
      if (t) counts[t.provider]++;
    }
    expect(counts.openai).toBeGreaterThan(counts.anthropic);
  });

  test('returns single provider when only one available', () => {
    const target = selectP2C(providers, new Set(['openai', 'google']));
    expect(target?.provider).toBe('anthropic');
  });

  test('returns null when all excluded', () => {
    expect(selectP2C(providers, all)).toBeNull();
  });
});

// ── selectLKGP ────────────────────────────────────────────────────────────────

describe('selectLKGP', () => {
  test('returns the last known good provider if available', () => {
    const target = selectLKGP(providers, new Set(), 'openai');
    expect(target?.provider).toBe('openai');
  });

  test('falls back to priority when lkgp is null', () => {
    const target = selectLKGP(providers, new Set(), null);
    expect(target?.provider).toBe('anthropic');
  });

  test('falls back to priority when lkgp is excluded', () => {
    const target = selectLKGP(providers, new Set(['openai']), 'openai');
    expect(target?.provider).toBe('anthropic');
  });

  test('returns null when all excluded', () => {
    expect(selectLKGP(providers, all)).toBeNull();
  });
});

// ── selectAuto ────────────────────────────────────────────────────────────────

describe('selectAuto', () => {
  test('returns a provider from the pool', () => {
    const target = selectAuto(providers);
    expect(['anthropic', 'openai', 'google']).toContain(target?.provider);
  });

  test('avoids high-error-rate providers', () => {
    const health = new Map([
      ['anthropic', makeHealth(0.9)],
      ['openai', makeHealth(0.05)],
      ['google', makeHealth(0.05)],
    ]);
    const counts: Record<string, number> = { anthropic: 0, openai: 0, google: 0 };
    for (let i = 0; i < 100; i++) {
      const t = selectAuto(providers, new Set(), health);
      if (t) counts[t.provider]++;
    }
    expect(counts.anthropic).toBeLessThan(counts.openai + counts.google);
  });

  test('returns null when all excluded', () => {
    expect(selectAuto(providers, all)).toBeNull();
  });
});
