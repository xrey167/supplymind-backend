import { db } from '../../infra/db/client';
import { orchestrations } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
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
