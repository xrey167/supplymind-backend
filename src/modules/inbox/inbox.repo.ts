import { eq, and, desc, sql, lt } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { inboxItems } from '../../infra/db/schema';
import type { CreateInboxItemInput, InboxFilter, InboxItem } from './inbox.types';

export class InboxRepository {
  async create(input: CreateInboxItemInput): Promise<InboxItem> {
    const rows = await db.insert(inboxItems).values({
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      metadata: input.metadata ?? {},
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    }).returning();
    return rows[0] as unknown as InboxItem;
  }

  async list(userId: string, workspaceId: string, filter: InboxFilter = {}): Promise<InboxItem[]> {
    const conditions = [
      eq(inboxItems.workspaceId, workspaceId),
    ];

    // Include items targeted at the user OR workspace-wide (userId IS NULL)
    conditions.push(
      sql`(${inboxItems.userId} = ${userId} OR ${inboxItems.userId} IS NULL)`,
    );

    if (filter.unreadOnly) {
      conditions.push(eq(inboxItems.read, false));
    }
    if (filter.type) {
      conditions.push(eq(inboxItems.type, filter.type));
    }
    if (filter.pinned !== undefined) {
      conditions.push(eq(inboxItems.pinned, filter.pinned));
    }

    return db.select()
      .from(inboxItems)
      .where(and(...conditions))
      .orderBy(desc(inboxItems.pinned), desc(inboxItems.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0) as unknown as Promise<InboxItem[]>;
  }

  async markRead(id: string): Promise<InboxItem | null> {
    const rows = await db.update(inboxItems)
      .set({ read: true })
      .where(eq(inboxItems.id, id))
      .returning();
    return (rows[0] as unknown as InboxItem) ?? null;
  }

  async markAllRead(userId: string, workspaceId: string): Promise<void> {
    await db.update(inboxItems)
      .set({ read: true })
      .where(
        and(
          eq(inboxItems.workspaceId, workspaceId),
          sql`(${inboxItems.userId} = ${userId} OR ${inboxItems.userId} IS NULL)`,
          eq(inboxItems.read, false),
        ),
      );
  }

  async togglePin(id: string): Promise<InboxItem | null> {
    const rows = await db.update(inboxItems)
      .set({ pinned: sql`NOT ${inboxItems.pinned}` })
      .where(eq(inboxItems.id, id))
      .returning();
    return (rows[0] as unknown as InboxItem) ?? null;
  }

  async getUnreadCount(userId: string, workspaceId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.workspaceId, workspaceId),
          sql`(${inboxItems.userId} = ${userId} OR ${inboxItems.userId} IS NULL)`,
          eq(inboxItems.read, false),
        ),
      );
    return Number(result[0]?.count ?? 0);
  }

  async deleteOlderThan(workspaceId: string, date: Date): Promise<number> {
    const result = await db.delete(inboxItems)
      .where(
        and(
          eq(inboxItems.workspaceId, workspaceId),
          lt(inboxItems.createdAt, date),
        ),
      )
      .returning({ id: inboxItems.id });
    return result.length;
  }
}

export const inboxRepo = new InboxRepository();
