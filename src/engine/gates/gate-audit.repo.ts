import { db } from '../../infra/db/client';
import { gateAuditLog } from '../../infra/db/schema';
import { eq, desc } from 'drizzle-orm';

export interface GateAuditRecord {
  orchestrationId: string;
  stepId: string;
  workspaceId: string;
  outcome: 'approved' | 'rejected' | 'timeout';
  decidedBy?: string;
  reason?: string;
  prompt?: string;
}

export const gateAuditRepo = {
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
  },

  async listByOrchestration(orchestrationId: string): Promise<typeof gateAuditLog.$inferSelect[]> {
    return db.select().from(gateAuditLog)
      .where(eq(gateAuditLog.orchestrationId, orchestrationId))
      .orderBy(desc(gateAuditLog.decidedAt));
  },
};

