import { describe, test, expect } from 'bun:test';
import { PolicyEngine } from '../workspace-policy.engine';
import type { Policy, PolicyContext } from '../workspace-policy.types';

const ctx: PolicyContext = {
  workspaceId: 'ws-1',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  tokensEstimated: 500,
  monthlyTokensUsed: 0,
  dailyTokensUsed: 0,
};

function makePolicy(overrides: Partial<Policy>): Policy {
  return {
    id: 'p-1',
    workspaceId: 'ws-1',
    name: 'test',
    type: 'access',
    enabled: true,
    priority: 10,
    conditions: {},
    actions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PolicyEngine', () => {
  test('empty policies — always allowed', () => {
    const engine = new PolicyEngine([]);
    const verdict = engine.evaluate(ctx);
    expect(verdict.allowed).toBe(true);
    expect(verdict.policyPhase).toBe('passed');
  });

  test('access policy blocks a specific model pattern', () => {
    const engine = new PolicyEngine([
      makePolicy({
        type: 'access',
        conditions: { model_pattern: 'gpt-*' },
        actions: { block: true },
      }),
    ]);
    const verdict = engine.evaluate({ ...ctx, model: 'gpt-4o', provider: 'openai' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.policyPhase).toBe('access');
  });

  test('access policy does NOT block non-matching model', () => {
    const engine = new PolicyEngine([
      makePolicy({
        type: 'access',
        conditions: { model_pattern: 'gpt-*' },
        actions: { block: true },
      }),
    ]);
    const verdict = engine.evaluate(ctx); // anthropic model — no match
    expect(verdict.allowed).toBe(true);
  });

  test('budget policy blocks when monthly limit exceeded', () => {
    const engine = new PolicyEngine([
      makePolicy({
        type: 'budget',
        actions: { max_monthly_tokens: 10_000 },
      }),
    ]);
    const verdict = engine.evaluate({ ...ctx, monthlyTokensUsed: 10_500 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.policyPhase).toBe('budget');
    expect(verdict.reason).toMatch(/monthly/i);
  });

  test('budget policy blocks when daily limit exceeded', () => {
    const engine = new PolicyEngine([
      makePolicy({ type: 'budget', actions: { max_daily_tokens: 1_000 } }),
    ]);
    const verdict = engine.evaluate({ ...ctx, dailyTokensUsed: 1_200 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.policyPhase).toBe('budget');
  });

  test('budget policy allows when under limit', () => {
    const engine = new PolicyEngine([
      makePolicy({ type: 'budget', actions: { max_monthly_tokens: 100_000 } }),
    ]);
    const verdict = engine.evaluate({ ...ctx, monthlyTokensUsed: 50_000 });
    expect(verdict.allowed).toBe(true);
  });

  test('routing policy adds preferred providers', () => {
    const engine = new PolicyEngine([
      makePolicy({
        type: 'routing',
        actions: { prefer_providers: ['openai', 'anthropic'] },
      }),
    ]);
    const verdict = engine.evaluate(ctx);
    expect(verdict.allowed).toBe(true);
    expect(verdict.adjustments.preferredProviders).toEqual(['openai', 'anthropic']);
  });

  test('policies sorted by priority — lower number runs first', () => {
    const blocked = makePolicy({ id: 'block', priority: 1, type: 'access', actions: { block: true } });
    const budget = makePolicy({ id: 'budget', priority: 5, type: 'budget', actions: { max_daily_tokens: 0 } });
    const engine = new PolicyEngine([budget, blocked]);
    const verdict = engine.evaluate(ctx);
    expect(verdict.policyPhase).toBe('access'); // access ran first (priority 1)
  });

  test('disabled policies are skipped', () => {
    const engine = new PolicyEngine([
      makePolicy({ enabled: false, type: 'access', actions: { block: true } }),
    ]);
    const verdict = engine.evaluate(ctx);
    expect(verdict.allowed).toBe(true);
  });

  test('glob wildcard * matches any suffix', () => {
    const engine = new PolicyEngine([
      makePolicy({ type: 'access', conditions: { model_pattern: 'claude-*' }, actions: { block: true } }),
    ]);
    expect(engine.evaluate({ ...ctx, model: 'claude-opus-4-6' }).allowed).toBe(false);
    expect(engine.evaluate({ ...ctx, model: 'gpt-4o', provider: 'openai' }).allowed).toBe(true);
  });
});
