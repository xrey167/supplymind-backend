import { eq, and, isNull, desc, asc, lt, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { notifications } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { CreateNotificationInput, NotificationFilter, NotificationChannel } from './notifications.types';

export const MAX_NOTIFICATION_ATTEMPTS = 3;

type NotificationRow = typeof notifications.$inferSelect;
type NotificationInsert = typeof notifications.$inferInsert;

export class NotificationsRepository extends BaseRepo<
  typeof notifications,
  NotificationRow,
  NotificationInsert
> {
  constructor() {
    super(notifications);
  }

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

  async markDelivered(id: string): Promise<boolean> {
    const rows = await db.update(notifications)
      .set({ status: 'delivered', lastAttemptedAt: new Date(), attemptCount: sql`${notifications.attemptCount} + 1` })
      .where(eq(notifications.id, id))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  async markFailed(id: string): Promise<boolean> {
    const rows = await db.update(notifications)
      .set({
        status: 'failed',
        lastAttemptedAt: new Date(),
        attemptCount: sql`${notifications.attemptCount} + 1`,
      })
      .where(eq(notifications.id, id))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  async listFailed(limit = 50): Promise<(typeof notifications.$inferSelect)[]> {
    // TODO: replace single global cap with per-workspace sub-queries (round-robin
    // across workspaces) so a high-failure workspace can't starve others.
    return db.select()
      .from(notifications)
      .where(
        and(
          eq(notifications.status, 'failed'),
          lt(notifications.attemptCount, MAX_NOTIFICATION_ATTEMPTS),
        ),
      )
      .orderBy(asc(notifications.lastAttemptedAt), asc(notifications.createdAt))
      .limit(limit);
  }
}

export const notificationsRepo = new NotificationsRepository();
