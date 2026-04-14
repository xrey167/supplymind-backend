import { eq, and, isNull, desc, asc, lt, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { notifications } from '../../infra/db/schema';
import type { CreateNotificationInput, NotificationFilter, NotificationChannel } from './notifications.types';

export const MAX_NOTIFICATION_ATTEMPTS = 3;

/** Maximum failed notifications fetched per workspace in each retry sweep */
export const PER_WORKSPACE_CAP = 10;

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

  async listFailed(batchSize = 50, perWorkspaceCap = PER_WORKSPACE_CAP): Promise<(typeof notifications.$inferSelect)[]> {
    // Per-workspace fairness: use a CTE with ROW_NUMBER() to rank failed
    // notifications within each workspace, take at most perWorkspaceCap rows
    // per workspace, then cap the full result at batchSize.  This prevents a
    // high-failure workspace from starving every other workspace in a retry sweep.
    const rows = await db.execute<typeof notifications.$inferSelect>(
      sql`
        WITH ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY workspace_id
              ORDER BY last_attempted_at ASC NULLS FIRST, created_at ASC
            ) AS rn
          FROM notifications
          WHERE status = 'failed'
            AND attempt_count < ${MAX_NOTIFICATION_ATTEMPTS}
        )
        SELECT id, workspace_id, user_id, type, title, body, metadata,
               channel, status, read_at, attempt_count, last_attempted_at,
               created_at, updated_at
        FROM ranked
        WHERE rn <= ${perWorkspaceCap}
        ORDER BY last_attempted_at ASC NULLS FIRST, created_at ASC
        LIMIT ${batchSize}
      `,
    );
    // Drizzle execute returns a ResultSet; rows are in .rows for postgres driver
    const rawRows = (rows as any).rows ?? rows;
    return (rawRows as any[]).map((r: any) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      body: r.body,
      metadata: r.metadata,
      channel: r.channel,
      status: r.status,
      readAt: r.read_at,
      attemptCount: r.attempt_count,
      lastAttemptedAt: r.last_attempted_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
}

export const notificationsRepo = new NotificationsRepository();
