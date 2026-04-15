import { eq, and } from 'drizzle-orm';
import { db } from '../../../infra/db/client';
import { notificationPreferences } from '../../../infra/db/schema';
import { BaseRepo } from '../../../infra/db/repositories/base.repo';
import type { NotificationChannel, QuietHours } from '../notifications.types';

type PrefRow = typeof notificationPreferences.$inferSelect;
type NewPref = typeof notificationPreferences.$inferInsert;

export interface UpsertPreferenceInput {
  userId: string;
  workspaceId: string;
  type: string;
  channels: NotificationChannel[];
  muted: boolean;
  quietHours?: QuietHours | null;
}

export class NotificationPreferencesRepository extends BaseRepo<typeof notificationPreferences, PrefRow, NewPref> {
  constructor() { super(notificationPreferences); }

  async get(userId: string, workspaceId: string, type: string) {
    const rows = await db.select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.workspaceId, workspaceId),
          eq(notificationPreferences.type, type),
        ),
      );
    return rows[0] ?? null;
  }

  async getGlobal(userId: string, workspaceId: string) {
    return this.get(userId, workspaceId, '__global__');
  }

  async upsert(input: UpsertPreferenceInput) {
    const rows = await db.insert(notificationPreferences)
      .values({
        userId: input.userId,
        workspaceId: input.workspaceId,
        type: input.type,
        channels: input.channels,
        muted: input.muted,
        quietHours: input.quietHours ?? null,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.workspaceId,
          notificationPreferences.type,
        ],
        set: {
          channels: input.channels,
          muted: input.muted,
          quietHours: input.quietHours ?? null,
        },
      })
      .returning();
    return rows[0]!;
  }

  async list(userId: string, workspaceId: string) {
    return db.select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.workspaceId, workspaceId),
        ),
      );
  }
}

export const notificationPreferencesRepo = new NotificationPreferencesRepository();
