import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { auditLogs } from '../../infra/db/schema';
import type { AuditLog, AuditStats, CreateAuditLogInput, AuditLogFilter } from './audit-logs.types';

export class AuditLogsRepository {
  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const rows = await db.insert(auditLogs).values({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
    }).returning();
    return rows[0] as unknown as AuditLog;
  }

  async list(filter: AuditLogFilter): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.workspaceId, filter.workspaceId)];

    if (filter.actorId) conditions.push(eq(auditLogs.actorId, filter.actorId));
    if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
    if (filter.resourceType) conditions.push(eq(auditLogs.resourceType, filter.resourceType));
    if (filter.resourceId) conditions.push(eq(auditLogs.resourceId, filter.resourceId));
    if (filter.since) conditions.push(gte(auditLogs.createdAt, filter.since));
    if (filter.until) conditions.push(lte(auditLogs.createdAt, filter.until));

    const rows = await db.select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);

    return rows as unknown as AuditLog[];
  }

  async count(filter: AuditLogFilter): Promise<number> {
    const conditions = [eq(auditLogs.workspaceId, filter.workspaceId)];

    if (filter.actorId) conditions.push(eq(auditLogs.actorId, filter.actorId));
    if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
    if (filter.resourceType) conditions.push(eq(auditLogs.resourceType, filter.resourceType));
    if (filter.resourceId) conditions.push(eq(auditLogs.resourceId, filter.resourceId));
    if (filter.since) conditions.push(gte(auditLogs.createdAt, filter.since));
    if (filter.until) conditions.push(lte(auditLogs.createdAt, filter.until));

    const result = await db.select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
  }

  async getStats(workspaceId: string): Promise<AuditStats> {
    const rows = await db.select().from(auditLogs)
      .where(eq(auditLogs.workspaceId, workspaceId));

    const byAction: Record<string, number> = {};
    const byResourceType: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    let oldestAt: Date | null = null;
    let newestAt: Date | null = null;

    for (const row of rows) {
      byAction[row.action] = (byAction[row.action] ?? 0) + 1;
      byResourceType[row.resourceType as string] = (byResourceType[row.resourceType as string] ?? 0) + 1;
      byActor[row.actorId] = (byActor[row.actorId] ?? 0) + 1;
      const ts = row.createdAt as Date;
      if (!oldestAt || ts < oldestAt) oldestAt = ts;
      if (!newestAt || ts > newestAt) newestAt = ts;
    }

    return {
      total: rows.length,
      byAction,
      byResourceType,
      byActor: Object.entries(byActor)
        .map(([actorId, count]) => ({ actorId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      oldestAt,
      newestAt,
    };
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await db.delete(auditLogs)
      .where(lte(auditLogs.createdAt, cutoff))
      .returning({ id: auditLogs.id });
    return result.length;
  }
}

export const auditLogsRepo = new AuditLogsRepository();
