import type { PlanTier, PlanLimits } from './billing.types';

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { maxAgents: 2, maxTasks: 50, monthlyTokenBudgetUsd: 5, maxMembers: 2 },
  starter: { maxAgents: 10, maxTasks: 500, monthlyTokenBudgetUsd: 50, maxMembers: 5 },
  pro: { maxAgents: 50, maxTasks: 5000, monthlyTokenBudgetUsd: 500, maxMembers: 25 },
  enterprise: { maxAgents: -1, maxTasks: -1, monthlyTokenBudgetUsd: -1, maxMembers: -1 },
};

const PRICE_TO_PLAN: Record<string, PlanTier> = {};

function loadPriceMappings() {
  const mappings: Array<[string, PlanTier]> = [
    [Bun.env.STRIPE_PRICE_STARTER ?? '', 'starter'],
    [Bun.env.STRIPE_PRICE_PRO ?? '', 'pro'],
    [Bun.env.STRIPE_PRICE_ENTERPRISE ?? '', 'enterprise'],
  ];
  for (const [priceId, plan] of mappings) {
    if (priceId) PRICE_TO_PLAN[priceId] = plan;
  }
}

export function getPlanFromPriceId(priceId: string): PlanTier {
  if (Object.keys(PRICE_TO_PLAN).length === 0) loadPriceMappings();
  return PRICE_TO_PLAN[priceId] ?? 'free';
}
