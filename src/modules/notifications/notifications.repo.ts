import { eq, and, isNull, desc, asc, lt, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { notifications } from '../../infra/db/schema';
import type { CreateNotificationInput, NotificationFilter, NotificationChannel } from './notifications.types';

export class NotificationsRepository {
  async create(input: CreateNotificationInput, channel: NotificationChannel = 'in_app') {
    const rows = await db.insert(notifications).values({
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      metadata: input.metadata ?? {},
      channel,
      status: 'pending',
    }).returning();
    return rows[0]!;
  }

  async list(userId: string, workspaceId: string, filter: NotificationFilter = {}) {
    const conditions = [
      eq(notifications.workspaceId, workspaceId),
      eq(notifications.userId, userId),
    ];

    if (filter.unreadOnly) {
      conditions.push(isNull(notifications.readAt));
    }
    if (filter.type) {
      conditions.push(eq(notifications.type, filter.type));
    }

    return db.select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);
  }

  async markRead(id: string) {
    const rows = await db.update(notifications)
      .set({ status: 'read', readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async markAllRead(userId: string, workspaceId: string) {
    await db.update(notifications)
      .set({ status: 'read', readAt: new Date() })
      .where(
        and(
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
  }

  async getUnreadCount(userId: string, workspaceId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
    return Number(result[0]?.count ?? 0);
  }

  async markDelivered(id: string): Promise<void> {
    await db.update(notifications)
      .set({
        status: 'delivered',
        lastAttemptedAt: new Date(),
        attemptCount: sql`${notifications.attemptCount} + 1`,
      })
      .where(eq(notifications.id, id));
  }

  async markFailed(id: string): Promise<void> {
    await db.update(notifications)
      .set({
        status: 'failed',
        lastAttemptedAt: new Date(),
        attemptCount: sql`${notifications.attemptCount} + 1`,
      })
      .where(eq(notifications.id, id));
  }

  async listFailed(limit = 50): Promise<(typeof notifications.$inferSelect)[]> {
    return db.select()
      .from(notifications)
      .where(
        and(
          eq(notifications.status, 'failed'),
          lt(notifications.attemptCount, 3),
        ),
      )
      .orderBy(asc(notifications.lastAttemptedAt))
      .limit(limit);
  }
}

export const notificationsRepo = new NotificationsRepository();
