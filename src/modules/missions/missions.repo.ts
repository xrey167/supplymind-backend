import { eq, and, lt, or, desc, sql, gte, lte, isNotNull, sum, count } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { missionRuns, missionWorkers, missionArtifacts, usageRecords } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type {
  MissionRun, MissionWorker, MissionArtifact,
  MissionStatus, MissionWorkerStatus, CreateArtifactInput, WorkerSpec,
  MissionAnalytics, MissionRunCost,
} from './missions.types';

type RunRow = typeof missionRuns.$inferSelect;
type NewRunRow = typeof missionRuns.$inferInsert;
type WorkerRow = typeof missionWorkers.$inferSelect;
type ArtifactRow = typeof missionArtifacts.$inferSelect;

function toRun(row: RunRow): MissionRun {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    missionId: row.missionId,
    name: row.name,
    mode: row.mode,
    status: row.status,
    input: (row.input as Record<string, unknown>) ?? {},
    output: row.output as Record<string, unknown> | null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    disciplineMaxRetries: row.disciplineMaxRetries ?? 3,
    budgetCents: row.budgetCents,
    spentCents: row.spentCents ?? 0,
    costBreakdown: (row.costBreakdown as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function toWorker(row: WorkerRow): MissionWorker {
  return {
    id: row.id,
    missionRunId: row.missionRunId,
    role: row.role,
    phase: row.phase,
    status: row.status,
    agentProfileId: row.agentProfileId,
    taskId: row.taskId,
    output: row.output as Record<string, unknown> | null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toArtifact(row: ArtifactRow): MissionArtifact {
  return {
    id: row.id,
    missionRunId: row.missionRunId,
    workerId: row.workerId,
    kind: row.kind,
    title: row.title,
    content: row.content,
    contentJson: row.contentJson as Record<string, unknown> | null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
  };
}

export class MissionsRepository extends BaseRepo<typeof missionRuns, RunRow, NewRunRow> {
  constructor() { super(missionRuns); }

  async createRun(workspaceId: string, data: {
    name: string;
    mode: MissionRun['mode'];
    input?: Record<string, unknown>;
    disciplineMaxRetries?: number;
    metadata?: Record<string, unknown>;
  }): Promise<MissionRun> {
    const rows = await db.insert(missionRuns).values({
      workspaceId,
      name: data.name,
      mode: data.mode,
      input: data.input ?? {},
      disciplineMaxRetries: data.disciplineMaxRetries ?? 3,
      metadata: data.metadata ?? {},
    }).returning();
    return toRun(rows[0]!);
  }

  async findRunById(id: string): Promise<MissionRun | null> {
    const rows = await db.select().from(missionRuns).where(eq(missionRuns.id, id)).limit(1);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async listRuns(workspaceId: string, opts?: { limit?: number; cursor?: string }): Promise<MissionRun[]> {
    const limit = opts?.limit ?? 20;
    const conditions = [eq(missionRuns.workspaceId, workspaceId)];

    if (opts?.cursor) {
      const [isoDate, cursorId] = opts.cursor.split('|');
      const cursorDate = isoDate ? new Date(isoDate) : null;
      if (cursorDate && !isNaN(cursorDate.getTime()) && cursorId) {
        conditions.push(
          or(
            lt(missionRuns.createdAt, cursorDate),
            and(
              sql`${missionRuns.createdAt} = ${cursorDate.toISOString()}`,
              lt(missionRuns.id, cursorId),
            ),
          )!,
        );
      }
    }

    const rows = await db.select().from(missionRuns)
      .where(and(...conditions))
      .orderBy(desc(missionRuns.createdAt), desc(missionRuns.id))
      .limit(limit);
    return rows.map(toRun);
  }

  async updateRunInput(id: string, payload: Record<string, unknown>): Promise<void> {
    await db.update(missionRuns)
      .set({ input: payload, updatedAt: new Date() })
      .where(eq(missionRuns.id, id));
  }

  async updateRunStatus(id: string, status: MissionStatus): Promise<MissionRun | null> {
    const set: Partial<typeof missionRuns.$inferInsert> = { status, updatedAt: new Date() };
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'rejected') {
      set.completedAt = new Date();
    }
    const rows = await db.update(missionRuns).set(set).where(eq(missionRuns.id, id)).returning();
    return rows[0] ? toRun(rows[0]) : null;
  }

  async createWorker(data: { missionRunId: string } & WorkerSpec & { agentProfileId?: string }): Promise<MissionWorker> {
    const rows = await db.insert(missionWorkers).values({
      missionRunId: data.missionRunId,
      role: data.role,
      phase: data.phase ?? null,
      agentProfileId: data.agentProfileId ?? null,
    }).returning();
    return toWorker(rows[0]!);
  }

  async updateWorkerStatus(id: string, status: MissionWorkerStatus): Promise<MissionWorker | null> {
    const rows = await db.update(missionWorkers)
      .set({ status, updatedAt: new Date() })
      .where(eq(missionWorkers.id, id))
      .returning();
    return rows[0] ? toWorker(rows[0]) : null;
  }

  async listWorkers(missionRunId: string): Promise<MissionWorker[]> {
    const rows = await db.select().from(missionWorkers)
      .where(eq(missionWorkers.missionRunId, missionRunId));
    return rows.map(toWorker);
  }

  async createArtifact(input: CreateArtifactInput): Promise<MissionArtifact> {
    const rows = await db.insert(missionArtifacts).values({
      missionRunId: input.missionRunId,
      workerId: input.workerId ?? null,
      kind: input.kind,
      title: input.title ?? null,
      content: input.content ?? null,
      contentJson: input.contentJson ?? null,
      metadata: input.metadata ?? {},
    }).returning();
    return toArtifact(rows[0]!);
  }

  async listArtifacts(missionRunId: string): Promise<MissionArtifact[]> {
    const rows = await db.select().from(missionArtifacts)
      .where(eq(missionArtifacts.missionRunId, missionRunId))
      .orderBy(desc(missionArtifacts.createdAt));
    return rows.map(toArtifact);
  }

  async updateRunSpent(id: string, additionalCents: number): Promise<MissionRun | null> {
    const rows = await db.update(missionRuns)
      .set({
        spentCents: sql`${missionRuns.spentCents} + ${additionalCents}`,
        updatedAt: new Date(),
      })
      .where(eq(missionRuns.id, id))
      .returning();
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findRunsByMissionId(missionId: string): Promise<MissionRun[]> {
    const rows = await db.select().from(missionRuns)
      .where(eq(missionRuns.missionId, missionId))
      .orderBy(desc(missionRuns.createdAt));
    return rows.map(toRun);
  }

  async costByProviderAndModel(
    workspaceId: string,
    since?: Date,
    until?: Date,
  ): Promise<MissionAnalytics['byProvider']> {
    const conditions = [
      eq(usageRecords.workspaceId, workspaceId),
      isNotNull(usageRecords.missionRunId),
    ];
    if (since) conditions.push(gte(usageRecords.createdAt, since));
    if (until) conditions.push(lte(usageRecords.createdAt, until));

    const rows = await db
      .select({
        provider: usageRecords.provider,
        model: usageRecords.model,
        totalCostUsd: sum(usageRecords.costUsd).mapWith(Number),
        runCount: count(usageRecords.missionRunId),
      })
      .from(usageRecords)
      .where(and(...conditions))
      .groupBy(usageRecords.provider, usageRecords.model);

    return rows.map(r => ({
      provider: r.provider,
      model: r.model,
      totalCostUsd: r.totalCostUsd ?? 0,
      runCount: r.runCount ?? 0,
    }));
  }

  async costForRun(missionRunId: string): Promise<MissionRunCost> {
    const rows = await db
      .select({
        provider: usageRecords.provider,
        model: usageRecords.model,
        costUsd: sum(usageRecords.costUsd).mapWith(Number),
        inputTokens: sum(usageRecords.inputTokens).mapWith(Number),
        outputTokens: sum(usageRecords.outputTokens).mapWith(Number),
        calls: count(),
      })
      .from(usageRecords)
      .where(eq(usageRecords.missionRunId, missionRunId))
      .groupBy(usageRecords.provider, usageRecords.model);

    const breakdown = rows.map(r => ({
      provider: r.provider,
      model: r.model,
      costUsd: r.costUsd ?? 0,
      inputTokens: r.inputTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      calls: r.calls ?? 0,
    }));

    const totalCostUsd = breakdown.reduce((acc, r) => acc + r.costUsd, 0);

    return { missionRunId, totalCostUsd, breakdown };
  }
}

export const missionsRepo = new MissionsRepository();
