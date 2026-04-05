import { eq, gte, desc, sql, and } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { usageRecords } from '../../infra/db/schema';
import type { InsertUsageRecord, WorkspaceSummaryRow } from './usage.types';

export const usageRepo = {
  async insert(data: InsertUsageRecord) {
    const rows = await db.insert(usageRecords).values(data).returning();
    return rows[0]!;
  },

  async sumByWorkspace(workspaceId: string, since: Date): Promise<WorkspaceSummaryRow[]> {
    return db
      .select({
        model: usageRecords.model,
        provider: usageRecords.provider,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`sum(${usageRecords.inputTokens})::int`,
        outputTokens: sql<number>`sum(${usageRecords.outputTokens})::int`,
        costUsd: sql<number>`sum(${usageRecords.costUsd})`,
      })
      .from(usageRecords)
      .where(and(eq(usageRecords.workspaceId, workspaceId), gte(usageRecords.createdAt, since)))
      .groupBy(usageRecords.model, usageRecords.provider);
  },

  async sumByAgent(workspaceId: string, since: Date) {
    return db
      .select({
        agentId: usageRecords.agentId,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<number>`sum(${usageRecords.costUsd})`,
      })
      .from(usageRecords)
      .where(and(eq(usageRecords.workspaceId, workspaceId), gte(usageRecords.createdAt, since)))
      .groupBy(usageRecords.agentId);
  },

  async listRecent(workspaceId: string, since: Date, limit = 100) {
    return db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.workspaceId, workspaceId), gte(usageRecords.createdAt, since)))
      .orderBy(desc(usageRecords.createdAt))
      .limit(limit);
  },

  async totalCost(workspaceId: string, since: Date): Promise<number> {
    const rows = await db
      .select({ total: sql<number>`coalesce(sum(${usageRecords.costUsd}), 0)` })
      .from(usageRecords)
      .where(and(eq(usageRecords.workspaceId, workspaceId), gte(usageRecords.createdAt, since)));
    return rows[0]?.total ?? 0;
  },
};
