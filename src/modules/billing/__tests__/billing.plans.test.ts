import { describe, test, expect, beforeEach } from 'bun:test';
import { PLAN_LIMITS, getPlanFromPriceId } from '../billing.plans';
import type { PlanTier } from '../billing.types';

describe('PLAN_LIMITS', () => {
  test('all four tiers are defined', () => {
    const tiers: PlanTier[] = ['free', 'starter', 'pro', 'enterprise'];
    for (const tier of tiers) {
      expect(PLAN_LIMITS[tier]).toBeDefined();
      expect(PLAN_LIMITS[tier].maxAgents).toBeDefined();
      expect(PLAN_LIMITS[tier].maxTasks).toBeDefined();
      expect(PLAN_LIMITS[tier].monthlyTokenBudgetUsd).toBeDefined();
      expect(PLAN_LIMITS[tier].maxMembers).toBeDefined();
    }
  });

  test('free tier has lowest limits', () => {
    expect(PLAN_LIMITS.free.maxAgents).toBe(2);
    expect(PLAN_LIMITS.free.maxTasks).toBe(50);
    expect(PLAN_LIMITS.free.monthlyTokenBudgetUsd).toBe(5);
    expect(PLAN_LIMITS.free.maxMembers).toBe(2);
  });

  test('enterprise tier has unlimited (-1)', () => {
    expect(PLAN_LIMITS.enterprise.maxAgents).toBe(-1);
    expect(PLAN_LIMITS.enterprise.maxTasks).toBe(-1);
    expect(PLAN_LIMITS.enterprise.monthlyTokenBudgetUsd).toBe(-1);
    expect(PLAN_LIMITS.enterprise.maxMembers).toBe(-1);
  });

  test('tiers scale up in order', () => {
    expect(PLAN_LIMITS.starter.maxAgents).toBeGreaterThan(PLAN_LIMITS.free.maxAgents);
    expect(PLAN_LIMITS.pro.maxAgents).toBeGreaterThan(PLAN_LIMITS.starter.maxAgents);
  });
});

describe('getPlanFromPriceId', () => {
  beforeEach(() => {
    // Set env vars for price mapping
    process.env.STRIPE_PRICE_STARTER = 'price_starter_123';
    process.env.STRIPE_PRICE_PRO = 'price_pro_456';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise_789';
  });

  test('returns free for unknown price ID', () => {
    expect(getPlanFromPriceId('price_unknown')).toBe('free');
  });

  test('maps configured price IDs to plans', () => {
    expect(getPlanFromPriceId('price_starter_123')).toBe('starter');
    expect(getPlanFromPriceId('price_pro_456')).toBe('pro');
    expect(getPlanFromPriceId('price_enterprise_789')).toBe('enterprise');
  });
});
