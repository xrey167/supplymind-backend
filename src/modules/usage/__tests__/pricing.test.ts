import { describe, it, expect } from 'bun:test';
import { calculateCost, resolveProvider } from '../pricing';

describe('calculateCost', () => {
  it('claude-sonnet-4-6: 1000 input + 1000 output = $0.018', () => {
    // (1000 * 3.00 + 1000 * 15.00) / 1_000_000 = 18000 / 1_000_000 = 0.018
    expect(calculateCost('claude-sonnet-4-6', 1_000, 1_000)).toBeCloseTo(0.018, 6);
  });

  it('unknown model uses fallback pricing and returns > 0', () => {
    expect(calculateCost('unknown-model-xyz', 1_000_000, 1_000_000)).toBeGreaterThan(0);
  });

  it('zero tokens = zero cost', () => {
    expect(calculateCost('claude-sonnet-4-6', 0, 0)).toBe(0);
  });

  it('gpt-4o pricing is correct (2.50 input / 10.00 output per 1M)', () => {
    // (1000 * 2.50 + 1000 * 10.00) / 1_000_000 = 12500 / 1_000_000 = 0.0125
    expect(calculateCost('gpt-4o', 1_000, 1_000)).toBeCloseTo(0.0125, 6);
  });
});

describe('resolveProvider', () => {
  it('claude models → anthropic', () => expect(resolveProvider('claude-sonnet-4-6')).toBe('anthropic'));
  it('gpt models → openai', () => expect(resolveProvider('gpt-4o')).toBe('openai'));
  it('gemini models → google', () => expect(resolveProvider('gemini-1.5-pro')).toBe('google'));
  it('o-series models → openai', () => expect(resolveProvider('o3-mini')).toBe('openai'));
  it('unknown → anthropic fallback', () => expect(resolveProvider('unknown-model')).toBe('anthropic'));
});
