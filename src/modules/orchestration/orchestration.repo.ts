import { db } from '../../infra/db/client';
import { orchestrations } from '../../infra/db/schema';
import { eq, and, lt, desc, inArray } from 'drizzle-orm';
import type { OrchestrationDefinition, OrchestrationStatus, StepResult } from './orchestration.types';

export const orchestrationRepo = {
  async create(data: {
    workspaceId: string;
    sessionId?: string;
    name?: string;
    definition: OrchestrationDefinition;
    input?: Record<string, unknown>;
  }) {
    const [row] = await db.insert(orchestrations).values({
      workspaceId: data.workspaceId,
      sessionId: data.sessionId,
      name: data.name,
      definition: data.definition,
      input: data.input ?? {},
    }).returning();
    return row;
  },

  async get(id: string) {
    const [row] = await db.select().from(orchestrations).where(eq(orchestrations.id, id)).limit(1);
    return row;
  },

  async list(workspaceId: string, opts?: { limit?: number; cursor?: string }) {
    const limit = opts?.limit ?? 20;
    const conditions = [eq(orchestrations.workspaceId, workspaceId)];
    if (opts?.cursor) {
      const cursorDate = new Date(opts.cursor);
      if (!isNaN(cursorDate.getTime())) {
        conditions.push(lt(orchestrations.createdAt, cursorDate));
      }
    }
    return db.select().from(orchestrations)
      .where(and(...conditions))
      .orderBy(desc(orchestrations.createdAt))
      .limit(limit);
  },

  async cancel(id: string): Promise<boolean> {
    const result = await db.update(orchestrations)
      .set({ status: 'failed' as any, completedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(orchestrations.id, id),
        inArray(orchestrations.status, ['submitted', 'running'] as any),
      ))
      .returning({ id: orchestrations.id });
    return result.length > 0;
  },

  async updateStatus(id: string, status: OrchestrationStatus, updates?: { stepResults?: Record<string, StepResult>; currentStepId?: string | null }) {
    await db.update(orchestrations)
      .set({
        status: status as any,
        updatedAt: new Date(),
        ...(updates?.stepResults && { stepResults: updates.stepResults }),
        ...(updates?.currentStepId !== undefined && { currentStepId: updates.currentStepId }),
        ...(status === 'completed' || status === 'failed' ? { completedAt: new Date() } : {}),
      })
      .where(eq(orchestrations.id, id));
  },
};
