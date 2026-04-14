import { usageRepo } from './usage.repo';
import { calculateCost, resolveProvider } from './pricing';
import { workspaceSettingsService } from '../settings/workspace-settings/workspace-settings.service';
import { incrementBudgetCounter } from '../../infra/billing/budget-counter';
import { logger } from '../../config/logger';
import type { RecordUsageInput } from './usage.types';

export interface BudgetCheckResult {
  allowed: boolean;
  usedUsd: number;
  limitUsd: number | null;
  pct: number;
  warningThreshold: number;
}

function periodToSince(period: 'day' | 'week' | 'month' | 'all'): Date {
  const now = new Date();
  if (period === 'day')   return new Date(now.getTime() - 86_400_000);
  if (period === 'week')  return new Date(now.getTime() - 7 * 86_400_000);
  if (period === 'month') return new Date(now.getTime() - 30 * 86_400_000);
  return new Date(0);
}

export const usageService = {
  async record(input: RecordUsageInput): Promise<void> {
    const provider = resolveProvider(input.model);
    const costUsd = calculateCost(input.model, input.inputTokens, input.outputTokens);
    await usageRepo.insert({
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      sessionId: input.sessionId ?? null,
      taskId: input.taskId ?? null,
      model: input.model,
      provider,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.inputTokens + input.outputTokens,
      costUsd,
    });
    // Increment the Redis atomic budget counter after persisting the DB record.
    // Fire-and-forget: a Redis failure must not break the usage recording path.
    if (costUsd > 0) {
      incrementBudgetCounter(input.workspaceId, costUsd).catch((err: unknown) =>
        logger.warn({ workspaceId: input.workspaceId, err }, 'Failed to increment Redis budget counter'),
      );
    }
  },

  async getWorkspaceSummary(workspaceId: string, period: 'day' | 'week' | 'month' | 'all' = 'month') {
    const since = periodToSince(period);
    const [byModel, byAgent, records] = await Promise.all([
      usageRepo.sumByWorkspace(workspaceId, since),
      usageRepo.sumByAgent(workspaceId, since),
      usageRepo.listRecent(workspaceId, since),
    ]);
    const totalCostUsd = byModel.reduce((sum, r) => sum + r.costUsd, 0);
    const totalInput = byModel.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutput = byModel.reduce((sum, r) => sum + r.outputTokens, 0);
    return {
      totalCostUsd,
      totalTokens: { input: totalInput, output: totalOutput },
      byModel,
      byAgent,
      records: records.map(r => ({
        id: r.id,
        model: r.model,
        provider: r.provider,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        createdAt: r.createdAt.toISOString(),
        taskId: r.taskId,
        agentId: r.agentId,
      })),
    };
  },

  async getTotalCost(workspaceId: string, since: Date): Promise<number> {
    return usageRepo.totalCost(workspaceId, since);
  },

  async checkBudget(workspaceId: string): Promise<BudgetCheckResult> {
    const budget = await workspaceSettingsService.getTokenBudget(workspaceId);
    if (!budget || !budget.monthlyLimitUsd) {
      return { allowed: true, usedUsd: 0, limitUsd: null, pct: 0, warningThreshold: 0.8 };
    }

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const usedUsd = await usageRepo.totalCost(workspaceId, startOfMonth);
    const pct = usedUsd / budget.monthlyLimitUsd;

    return {
      allowed: usedUsd < budget.monthlyLimitUsd,
      usedUsd,
      limitUsd: budget.monthlyLimitUsd,
      pct,
      warningThreshold: budget.warningThreshold,
    };
  },
};
