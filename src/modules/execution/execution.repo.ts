import { db } from '../../infra/db/client';
import { executionPlans, executionRuns } from '../../infra/db/schema';
import { eq, desc } from 'drizzle-orm';
import type {
  ExecutionPlanRow,
  ExecutionRunRow,
  ExecutionStep,
  ExecutionPolicy,
  IntentClassification,
  ExecutionPlanStatus,
} from './execution.types';

export const executionRepo = {
  async createPlan(data: {
    workspaceId: string;
    name?: string;
    steps: ExecutionStep[];
    input?: Record<string, unknown>;
    policy?: ExecutionPolicy;
    createdBy: string;
  }): Promise<ExecutionPlanRow> {
    const [row] = await db.insert(executionPlans).values({
      workspaceId: data.workspaceId,
      name: data.name,
      steps: data.steps,
      input: data.input ?? {},
      policy: data.policy ?? {},
      createdBy: data.createdBy,
    }).returning();
    return row as unknown as ExecutionPlanRow;
  },

  async getPlan(id: string): Promise<ExecutionPlanRow | undefined> {
    const [row] = await db.select().from(executionPlans)
      .where(eq(executionPlans.id, id)).limit(1);
    return row as unknown as ExecutionPlanRow | undefined;
  },

  async updatePlanStatus(
    id: string,
    status: ExecutionPlanStatus,
    intent?: IntentClassification,
  ): Promise<void> {
    await db.update(executionPlans)
      .set({
        status,
        updatedAt: new Date(),
        ...(intent !== undefined && { intent }),
      })
      .where(eq(executionPlans.id, id));
  },

  async listPlans(workspaceId: string, limit = 20): Promise<ExecutionPlanRow[]> {
    return db.select().from(executionPlans)
      .where(eq(executionPlans.workspaceId, workspaceId))
      .orderBy(desc(executionPlans.createdAt))
      .limit(limit) as unknown as Promise<ExecutionPlanRow[]>;
  },

  async createRun(data: {
    planId: string;
    workspaceId: string;
    intent?: IntentClassification;
    orchestrationId?: string;
    status?: string;
  }): Promise<ExecutionRunRow> {
    const [row] = await db.insert(executionRuns).values({
      planId: data.planId,
      workspaceId: data.workspaceId,
      intent: data.intent as any ?? null,
      orchestrationId: data.orchestrationId ?? null,
      status: data.status ?? 'running',
    }).returning();
    return row as unknown as ExecutionRunRow;
  },

  async getRun(id: string): Promise<ExecutionRunRow | undefined> {
    const [row] = await db.select().from(executionRuns)
      .where(eq(executionRuns.id, id)).limit(1);
    return row as unknown as ExecutionRunRow | undefined;
  },

  async getRunsByPlan(planId: string): Promise<ExecutionRunRow[]> {
    return db.select().from(executionRuns)
      .where(eq(executionRuns.planId, planId))
      .orderBy(desc(executionRuns.startedAt)) as unknown as Promise<ExecutionRunRow[]>;
  },

  async updateRunStatus(id: string, status: string, orchestrationId?: string): Promise<void> {
    await db.update(executionRuns)
      .set({
        status,
        ...(orchestrationId && { orchestrationId }),
        ...(status !== 'running' && { completedAt: new Date() }),
      })
      .where(eq(executionRuns.id, id));
  },
};
