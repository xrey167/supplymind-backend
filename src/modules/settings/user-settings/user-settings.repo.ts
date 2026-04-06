import { eq, and } from 'drizzle-orm';
import { db } from '../../../infra/db/client';
import { userSettings } from '../../../infra/db/schema';

export class UserSettingsRepository {
  async get(userId: string, key: string): Promise<unknown | null> {
    const rows = await db
      .select()
      .from(userSettings)
      .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)));
    return rows[0]?.value ?? null;
  }

  async getAll(userId: string): Promise<Record<string, unknown>> {
    const rows = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async set(userId: string, key: string, value: unknown): Promise<void> {
    const existing = await db
      .select()
      .from(userSettings)
      .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)));
    if (existing.length > 0) {
      await db
        .update(userSettings)
        .set({ value, updatedAt: new Date() })
        .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)));
    } else {
      await db
        .insert(userSettings)
        .values({ userId, key, value });
    }
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const rows = await db
      .delete(userSettings)
      .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
      .returning();
    return rows.length > 0;
  }
}

export const userSettingsRepo = new UserSettingsRepository();
