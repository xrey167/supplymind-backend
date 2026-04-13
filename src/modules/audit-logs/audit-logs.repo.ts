import { eq, and, desc, sql, gte, lte, lt } from 'drizzle-orm';
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
    const where = eq(auditLogs.workspaceId, workspaceId);

    const [summaryRows, byActionRows, byResourceTypeRows, byActorRows] = await Promise.all([
      db.select({
        total: sql<number>`count(*)`,
        oldestAt: sql<string | null>`min(${auditLogs.createdAt})`,
        newestAt: sql<string | null>`max(${auditLogs.createdAt})`,
      }).from(auditLogs).where(where),

      db.select({
        action: auditLogs.action,
        count: sql<number>`count(*)`,
      }).from(auditLogs).where(where).groupBy(auditLogs.action),

      db.select({
        resourceType: auditLogs.resourceType,
        count: sql<number>`count(*)`,
      }).from(auditLogs).where(where).groupBy(auditLogs.resourceType),

      db.select({
        actorId: auditLogs.actorId,
        count: sql<number>`count(*)`,
      }).from(auditLogs).where(where).groupBy(auditLogs.actorId)
        .orderBy(desc(sql`count(*)`)).limit(20),
    ]);

    const summary = summaryRows[0];
    return {
      total: Number(summary?.total ?? 0),
      byAction: Object.fromEntries(byActionRows.map(r => [r.action, Number(r.count)])),
      byResourceType: Object.fromEntries(byResourceTypeRows.map(r => [r.resourceType as string, Number(r.count)])),
      byActor: byActorRows.map(r => ({ actorId: r.actorId, count: Number(r.count) })),
      oldestAt: summary?.oldestAt ? new Date(summary.oldestAt) : null,
      newestAt: summary?.newestAt ? new Date(summary.newestAt) : null,
    };
  }

  // Use lt (strictly less than) so records created at exactly the cutoff are retained.
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await db.delete(auditLogs)
      .where(lt(auditLogs.createdAt, cutoff))
      .returning({ id: auditLogs.id });
    return result.length;
  }
}

export const auditLogsRepo = new AuditLogsRepository();
