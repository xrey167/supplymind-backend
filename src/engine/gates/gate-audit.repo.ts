import { db } from '../../infra/db/client';
import { gateAuditLog } from '../../infra/db/schema';
import { eq, desc } from 'drizzle-orm';
import { BaseRepo } from '../../infra/db/repositories/base.repo';

type Row = typeof gateAuditLog.$inferSelect;
type NewRow = typeof gateAuditLog.$inferInsert;

export interface GateAuditRecord {
  orchestrationId: string;
  stepId: string;
  workspaceId: string;
  outcome: 'approved' | 'rejected' | 'timeout';
  decidedBy?: string;
  reason?: string;
  prompt?: string;
}

class GateAuditRepository extends BaseRepo<typeof gateAuditLog, Row, NewRow> {
  constructor() { super(gateAuditLog); }

  async insert(record: GateAuditRecord): Promise<void> {
    await db.insert(gateAuditLog).values({
      orchestrationId: record.orchestrationId,
      stepId: record.stepId,
      workspaceId: record.workspaceId,
      outcome: record.outcome,
      decidedBy: record.decidedBy ?? null,
      reason: record.reason ?? null,
      prompt: record.prompt ?? null,
    });
  }

  async listByOrchestration(orchestrationId: string): Promise<Row[]> {
    return db.select().from(gateAuditLog)
      .where(eq(gateAuditLog.orchestrationId, orchestrationId))
      .orderBy(desc(gateAuditLog.decidedAt));
  }

  override async update(): Promise<never> {
    throw new Error('GateAuditRepository: audit records are immutable');
  }

  override async remove(): Promise<never> {
    throw new Error('GateAuditRepository: audit records cannot be deleted');
  }
}

export const gateAuditRepo = new GateAuditRepository();
