/**
 * Routing Analyzer
 *
 * Detects model routing mismatches: tasks that failed frequently suggest
 * the model tier was too low. Proposes routing_rule adjustments.
 *
 * Currently a lightweight heuristic — Phase 3 will add LLM-based analysis.
 */

import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { ImprovementProposal } from './skill-weight-analyzer';

const TASK_ERROR_THRESHOLD = 0.25; // >25% task error rate → suggest routing upgrade

export async function analyzeRouting(workspaceId: string, dbClient = db): Promise<ImprovementProposal[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [completedRows, errorRows] = await Promise.all([
    dbClient
      .select({ count: sql<number>`count(*)::int` })
      .from(learningObservations)
      .where(and(
        eq(learningObservations.workspaceId, workspaceId),
        eq(learningObservations.observationType, 'task_completed'),
        gte(learningObservations.createdAt, since),
      )),
    dbClient
      .select({ count: sql<number>`count(*)::int` })
      .from(learningObservations)
      .where(and(
        eq(learningObservations.workspaceId, workspaceId),
        eq(learningObservations.observationType, 'task_error'),
        gte(learningObservations.createdAt, since),
      )),
  ]);

  const completed = completedRows[0]?.count ?? 0;
  const errors = errorRows[0]?.count ?? 0;
  const total = completed + errors;

  if (total < 10) return []; // not enough data

  const errorRate = errors / total;
  if (errorRate < TASK_ERROR_THRESHOLD) return [];

  return [{
    workspaceId,
    proposalType: 'routing_rule',
    changeType: 'behavioral',
    description: `Task error rate is ${Math.round(errorRate * 100)}% over 24h (${errors}/${total} tasks). Consider using a higher model tier (BALANCED → POWERFUL) for this workspace.`,
    evidence: [
      `task_error_rate=${errorRate.toFixed(2)}`,
      `total_tasks=${total}`,
      `error_count=${errors}`,
    ],
    beforeValue: { tier: 'balanced' },
    afterValue: { tier: 'powerful', reason: 'high_task_error_rate' },
    confidence: Math.min(0.85, errorRate * 2),
  }];
}
