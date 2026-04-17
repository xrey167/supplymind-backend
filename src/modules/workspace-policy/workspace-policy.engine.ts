import type { Policy, PolicyContext, PolicyVerdict } from './workspace-policy.types';

function globMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
  );
  return regex.test(value);
}

function matchesConditions(policy: Policy, ctx: PolicyContext): boolean {
  const { conditions } = policy;
  if (conditions.model_pattern && !globMatch(conditions.model_pattern, ctx.model)) return false;
  if (conditions.provider && conditions.provider !== ctx.provider) return false;
  return true;
}

export class PolicyEngine {
  private readonly policies: Policy[];

  constructor(policies: Policy[]) {
    // Sort by priority ascending (lower number = higher priority), filter disabled
    this.policies = [...policies]
      .filter((p) => p.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  evaluate(ctx: PolicyContext): PolicyVerdict {
    const verdict: PolicyVerdict = {
      allowed: true,
      reason: null,
      policyPhase: 'passed',
      appliedPolicies: [],
      adjustments: { preferredProviders: [] },
    };

    for (const policy of this.policies) {
      if (!matchesConditions(policy, ctx)) continue;

      switch (policy.type) {
        case 'access': {
          if (policy.actions.block) {
            verdict.allowed = false;
            verdict.reason = `Model "${ctx.model}" blocked by policy "${policy.name}"`;
            verdict.policyPhase = 'access';
            verdict.appliedPolicies.push(policy.name);
            return verdict;
          }
          break;
        }

        case 'budget': {
          const { max_monthly_tokens, max_daily_tokens } = policy.actions;
          if (max_monthly_tokens != null && ctx.monthlyTokensUsed >= max_monthly_tokens) {
            verdict.allowed = false;
            verdict.reason = `Monthly token budget exceeded (${ctx.monthlyTokensUsed}/${max_monthly_tokens})`;
            verdict.policyPhase = 'budget';
            verdict.appliedPolicies.push(policy.name);
            return verdict;
          }
          if (max_daily_tokens != null && ctx.dailyTokensUsed >= max_daily_tokens) {
            verdict.allowed = false;
            verdict.reason = `Daily token budget exceeded (${ctx.dailyTokensUsed}/${max_daily_tokens})`;
            verdict.policyPhase = 'budget';
            verdict.appliedPolicies.push(policy.name);
            return verdict;
          }
          break;
        }

        case 'routing': {
          if (policy.actions.prefer_providers) {
            verdict.adjustments.preferredProviders.push(...policy.actions.prefer_providers);
          }
          break;
        }
      }

      verdict.appliedPolicies.push(policy.name);
    }

    return verdict;
  }
}
