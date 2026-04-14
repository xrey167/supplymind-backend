import { db } from '../../../infra/db/client';
import { syncJobs } from '../../../infra/db/schema';
import { eq, and, isNotNull, ne } from 'drizzle-orm';

export interface SyncJobRow {
  id: string;
  installationId: string;
  workspaceId: string;
  entityType: string;
  schedule: string | null;
  status: string;
  lastRunAt: Date | null;
  lastError: string | null;
  cursor: string | null;
  createdAt: Date;
}

export interface CreateSyncJobInput {
  installationId: string;
  workspaceId: string;
  entity: string;
  schedule?: string;
}

const syncJobColumns = {
  id: syncJobs.id,
  installationId: syncJobs.installationId,
  workspaceId: syncJobs.workspaceId,
  entityType: syncJobs.entityType,
  schedule: syncJobs.schedule,
  status: syncJobs.status,
  lastRunAt: syncJobs.lastRunAt,
  lastError: syncJobs.lastError,
  cursor: syncJobs.cursor,
  createdAt: syncJobs.createdAt,
};

export const syncJobsRepo = {
  async list(workspaceId: string): Promise<SyncJobRow[]> {
    return db
      .select(syncJobColumns)
      .from(syncJobs)
      .where(eq(syncJobs.workspaceId, workspaceId));
  },

  async findById(id: string): Promise<SyncJobRow | undefined> {
    const rows = await db
      .select(syncJobColumns)
      .from(syncJobs)
      .where(eq(syncJobs.id, id))
      .limit(1);
    return rows[0];
  },

  async create(input: CreateSyncJobInput): Promise<SyncJobRow> {
    const rows = await db
      .insert(syncJobs)
      .values({
        installationId: input.installationId,
        workspaceId: input.workspaceId,
        entityType: input.entity,
        schedule: input.schedule ?? null,
        batchSize: 100,
      })
      .returning(syncJobColumns);
    return rows[0]!;
  },

  async delete(id: string): Promise<{ deleted: boolean }> {
    const rows = await db
      .delete(syncJobs)
      .where(eq(syncJobs.id, id))
      .returning({ id: syncJobs.id });
    return { deleted: rows.length > 0 };
  },

  async resetFailed(workspaceId: string, limit = 100): Promise<{ replayed: number }> {
    const rows = await db
      .update(syncJobs)
      .set({ status: 'idle', lastError: null, retryCount: 0 })
      .where(and(eq(syncJobs.workspaceId, workspaceId), eq(syncJobs.status, 'failed')))
      .returning({ id: syncJobs.id });
    return { replayed: rows.length };
  },

  async updateCursor(jobId: string, cursor: string): Promise<void> {
    await db.update(syncJobs).set({ cursor }).where(eq(syncJobs.id, jobId));
  },

  async listScheduled(): Promise<SyncJobRow[]> {
    return db.select(syncJobColumns).from(syncJobs)
      .where(and(isNotNull(syncJobs.schedule), ne(syncJobs.status, 'failed')));
  },

  async updateSchedule(id: string, schedule: string | null): Promise<void> {
    await db.update(syncJobs).set({ schedule }).where(eq(syncJobs.id, id));
  },
};
