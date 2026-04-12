/**
 * Memory Analyzer
 *
 * Detects poor memory extraction quality by examining the ratio of
 * rejected vs. approved memory proposals. High rejection rate suggests
 * the extraction threshold (MIN_CONFIDENCE) should be raised.
 */

import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { ImprovementProposal } from './skill-weight-analyzer';

const REJECTION_RATE_THRESHOLD = 0.5; // >50% rejections → raise threshold
const MIN_EVENTS = 5;

export async function analyzeMemoryQuality(workspaceId: string, dbClient = db): Promise<ImprovementProposal[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7-day window for memory

  const [approvedRows, rejectedRows] = await Promise.all([
    dbClient
      .select({ count: sql<number>`count(*)::int` })
      .from(learningObservations)
      .where(and(
        eq(learningObservations.workspaceId, workspaceId),
        eq(learningObservations.observationType, 'memory_approved'),
        gte(learningObservations.createdAt, since),
      )),
    dbClient
      .select({ count: sql<number>`count(*)::int` })
      .from(learningObservations)
      .where(and(
        eq(learningObservations.workspaceId, workspaceId),
        eq(learningObservations.observationType, 'memory_rejected'),
        gte(learningObservations.createdAt, since),
      )),
  ]);

  const approved = approvedRows[0]?.count ?? 0;
  const rejected = rejectedRows[0]?.count ?? 0;
  const total = approved + rejected;

  if (total < MIN_EVENTS) return [];

  const rejectionRate = rejected / total;
  if (rejectionRate < REJECTION_RATE_THRESHOLD) return [];

  const currentThreshold = 0.7;
  const newThreshold = Math.min(0.95, currentThreshold + 0.1);

  return [{
    workspaceId,
    proposalType: 'memory_threshold',
    changeType: 'behavioral',
    description: `Memory rejection rate is ${Math.round(rejectionRate * 100)}% over 7 days (${rejected}/${total}). Raising auto-extraction confidence threshold from ${currentThreshold} to ${newThreshold}.`,
    evidence: [
      `rejection_rate=${rejectionRate.toFixed(2)}`,
      `approved=${approved}`,
      `rejected=${rejected}`,
    ],
    beforeValue: { minConfidence: currentThreshold },
    afterValue: { minConfidence: newThreshold },
    confidence: Math.min(0.9, rejectionRate),
  }];
}
