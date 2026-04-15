import { eq, and } from 'drizzle-orm';
import { db } from '../../../infra/db/client';
import { workspaceSettings } from '../../../infra/db/schema';
import { BaseRepo } from '../../../infra/db/repositories/base.repo';

type Row = typeof workspaceSettings.$inferSelect;
type NewRow = typeof workspaceSettings.$inferInsert;

export class WorkspaceSettingsRepository extends BaseRepo<typeof workspaceSettings, Row, NewRow> {
  constructor() { super(workspaceSettings); }

  async get(workspaceId: string, key: string) {
    const rows = await db
      .select()
      .from(workspaceSettings)
      .where(and(eq(workspaceSettings.workspaceId, workspaceId), eq(workspaceSettings.key, key)));
    return rows[0] ?? null;
  }

  async getAll(workspaceId: string) {
    return db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId));
  }

  async set(workspaceId: string, key: string, value: unknown) {
    const existing = await this.get(workspaceId, key);
    if (existing) {
      const rows = await db
        .update(workspaceSettings)
        .set({ value, updatedAt: new Date() })
        .where(and(eq(workspaceSettings.workspaceId, workspaceId), eq(workspaceSettings.key, key)))
        .returning();
      return rows[0];
    }
    const rows = await db
      .insert(workspaceSettings)
      .values({ workspaceId, key, value })
      .returning();
    return rows[0];
  }

  async delete(workspaceId: string, key: string) {
    const rows = await db
      .delete(workspaceSettings)
      .where(and(eq(workspaceSettings.workspaceId, workspaceId), eq(workspaceSettings.key, key)))
      .returning();
    return rows.length > 0;
  }
}

export const workspaceSettingsRepo = new WorkspaceSettingsRepository();
