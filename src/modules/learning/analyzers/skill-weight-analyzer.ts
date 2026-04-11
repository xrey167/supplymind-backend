/**
 * Skill Weight Analyzer
 *
 * Reads 24h skill performance metrics and produces ImprovementProposal[]
 * of type 'skill_weight' for skills whose failure rate exceeds 30%.
 */

import { db } from '../../../infra/db/client';
import { skillPerformanceMetrics } from '../../../infra/db/schema';
import { eq, gte } from 'drizzle-orm';

export interface ImprovementProposal {
  workspaceId: string;
  pluginId?: string;
  proposalType: string;
  changeType: 'behavioral' | 'structural';
  description: string;
  evidence: string[];
  beforeValue: unknown;
  afterValue: unknown;
  confidence: number;
}

const FAILURE_RATE_THRESHOLD = 0.3; // 30%
const MIN_INVOCATIONS = 5; // need at least 5 calls before judging

export async function analyzeSkillWeights(workspaceId: string): Promise<ImprovementProposal[]> {
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const metrics = await db
    .select()
    .from(skillPerformanceMetrics)
    .where(
      eq(skillPerformanceMetrics.workspaceId, workspaceId),
    );

  const proposals: ImprovementProposal[] = [];

  for (const metric of metrics) {
    if (metric.invocationCount < MIN_INVOCATIONS) continue;
    if (metric.windowStart < windowStart) continue; // stale window

    const failureRate = metric.failureCount / metric.invocationCount;
    if (failureRate < FAILURE_RATE_THRESHOLD) continue;

    const currentPriority = 3; // default plugin priority; future: read from skill_definitions
    const newPriority = Math.max(1, currentPriority - 1); // lower priority = lower chance of being selected

    proposals.push({
      workspaceId,
      pluginId: metric.pluginId ?? undefined,
      proposalType: 'skill_weight',
      changeType: 'behavioral',
      description: `Skill "${metric.skillId}" has ${Math.round(failureRate * 100)}% failure rate (${metric.failureCount}/${metric.invocationCount} calls). Reducing priority from ${currentPriority} to ${newPriority}.`,
      evidence: [
        `failure_rate=${failureRate.toFixed(2)}`,
        `invocations=${metric.invocationCount}`,
        `failures=${metric.failureCount}`,
        metric.lastFailureReason ? `last_error=${metric.lastFailureReason}` : '',
      ].filter(Boolean),
      beforeValue: { skillId: metric.skillId, priority: currentPriority },
      afterValue: { skillId: metric.skillId, priority: newPriority },
      confidence: Math.min(0.95, failureRate * 2), // scale confidence with failure severity
    });
  }

  return proposals;
}
