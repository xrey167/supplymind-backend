import { describe, test, expect } from 'bun:test';
import {
  selectPriority,
  selectRoundRobin,
  selectWeighted,
  selectCostOptimized,
} from '../strategies';
import type { ProviderEntry } from '../types';

const providers: ProviderEntry[] = [
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', weight: 50, costPer1kTokens: 0.0025 },
  { provider: 'openai',    model: 'gpt-4o-mini',               weight: 30, costPer1kTokens: 0.0015 },
  { provider: 'google',    model: 'gemini-1.5-flash',           weight: 20, costPer1kTokens: 0.001 },
];

describe('selectPriority', () => {
  test('returns the first provider', () => {
    expect(selectPriority(providers).provider).toBe('anthropic');
  });

  test('returns second when first is excluded', () => {
    expect(selectPriority(providers, new Set(['anthropic'])).provider).toBe('openai');
  });

  test('returns null when all excluded', () => {
    const all = new Set(['anthropic', 'openai', 'google']);
    expect(selectPriority(providers, all)).toBeNull();
  });
});

describe('selectRoundRobin', () => {
  test('cycles through providers by index', () => {
    expect(selectRoundRobin(providers, 0).provider).toBe('anthropic');
    expect(selectRoundRobin(providers, 1).provider).toBe('openai');
    expect(selectRoundRobin(providers, 2).provider).toBe('google');
    expect(selectRoundRobin(providers, 3).provider).toBe('anthropic'); // wraps
  });

  test('skips excluded providers', () => {
    expect(selectRoundRobin(providers, 0, new Set(['anthropic'])).provider).toBe('openai');
  });

  test('returns null when all excluded', () => {
    expect(selectRoundRobin(providers, 0, new Set(['anthropic', 'openai', 'google']))).toBeNull();
  });
});

describe('selectWeighted', () => {
  test('respects weight distribution over many draws', () => {
    const counts: Record<string, number> = { anthropic: 0, openai: 0, google: 0 };
    for (let i = 0; i < 1000; i++) {
      const target = selectWeighted(providers);
      if (target) counts[target.provider]++;
    }
    // anthropic ~50%, openai ~30%, google ~20% — allow ±15% tolerance
    expect(counts.anthropic).toBeGreaterThan(350);
    expect(counts.anthropic).toBeLessThan(650);
    expect(counts.openai).toBeGreaterThan(150);
    expect(counts.google).toBeGreaterThan(50);
  });

  test('skips excluded providers', () => {
    for (let i = 0; i < 50; i++) {
      const target = selectWeighted(providers, new Set(['anthropic']));
      expect(target?.provider).not.toBe('anthropic');
    }
  });
});

describe('selectCostOptimized', () => {
  test('returns cheapest provider', () => {
    const target = selectCostOptimized(providers);
    expect(target?.provider).toBe('google'); // costPer1kTokens: 0.001
  });

  test('skips excluded and picks next cheapest', () => {
    const target = selectCostOptimized(providers, new Set(['google']));
    expect(target?.provider).toBe('openai'); // costPer1kTokens: 0.0015
  });

  test('returns null when all excluded', () => {
    expect(selectCostOptimized(providers, new Set(['anthropic', 'openai', 'google']))).toBeNull();
  });
});
