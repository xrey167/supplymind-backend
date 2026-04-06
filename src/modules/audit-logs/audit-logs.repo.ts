import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { auditLogs } from '../../infra/db/schema';
import type { AuditLog, CreateAuditLogInput, AuditLogFilter } from './audit-logs.types';

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
}

export const auditLogsRepo = new AuditLogsRepository();
