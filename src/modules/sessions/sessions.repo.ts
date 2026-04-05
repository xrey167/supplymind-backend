import { db } from '../../infra/db/client';
import { sessions, sessionMessages } from '../../infra/db/schema';
import { eq, and, lt, gt, lte, count, desc, or } from 'drizzle-orm';
import type { Session, SessionMessage, AddMessageInput, SessionStatus } from './sessions.types';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.0);
}

export const sessionsRepo = {
  async create(data: { workspaceId: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<Session> {
    const [row] = await db.insert(sessions).values({
      workspaceId: data.workspaceId,
      agentId: data.agentId,
      metadata: data.metadata ?? {},
    }).returning();
    return row as unknown as Session;
  },

  async get(id: string): Promise<Session | undefined> {
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row as unknown as Session | undefined;
  },

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    await db.update(sessions)
      .set({
        status: status as any,
        updatedAt: new Date(),
        ...(status === 'closed' && { closedAt: new Date() }),
      })
      .where(eq(sessions.id, id));
  },

  async addMessage(sessionId: string, input: AddMessageInput): Promise<SessionMessage> {
    const tokenEstimate = estimateTokens(input.content);
    const [row] = await db.insert(sessionMessages).values({
      sessionId,
      role: input.role as any,
      content: input.content,
      toolCallId: input.toolCallId,
      toolCalls: input.toolCalls,
      tokenEstimate,
    }).returning();

    await db.update(sessions)
      .set({ updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    return row as unknown as SessionMessage;
  },

  async getMessages(sessionId: string, opts?: { limit?: number; excludeCompacted?: boolean }): Promise<SessionMessage[]> {
    let query = db.select().from(sessionMessages).where(eq(sessionMessages.sessionId, sessionId));
    if (opts?.excludeCompacted) {
      query = query.where(and(eq(sessionMessages.sessionId, sessionId), eq(sessionMessages.isCompacted, false))) as any;
    }
    const rows = await (query as any).orderBy(sessionMessages.createdAt).limit(opts?.limit ?? 1000);
    return rows as unknown as SessionMessage[];
  },

  async getMessagePage(
    sessionId: string,
    opts: {
      limit?: number;
      cursor?: string;
      includeCompacted?: boolean;
    } = {},
  ): Promise<{ messages: SessionMessage[]; total: number }> {
    const limit = Math.min(opts.limit ?? 50, 100);
    const includeCompacted = opts.includeCompacted ?? false;

    // Build base filter
    const baseFilter = includeCompacted
      ? eq(sessionMessages.sessionId, sessionId)
      : and(eq(sessionMessages.sessionId, sessionId), eq(sessionMessages.isCompacted, false));

    // Count total (without cursor/limit)
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(sessionMessages)
      .where(baseFilter);

    // Build cursor filter
    let cursorFilter = baseFilter;
    if (opts.cursor) {
      // Use (createdAt, id) as composite cursor for deterministic ordering
      const [cursorRow] = await db
        .select({ createdAt: sessionMessages.createdAt, id: sessionMessages.id })
        .from(sessionMessages)
        .where(eq(sessionMessages.id, opts.cursor))
        .limit(1);
      if (cursorRow) {
        cursorFilter = and(
          baseFilter,
          or(
            gt(sessionMessages.createdAt, cursorRow.createdAt),
            and(eq(sessionMessages.createdAt, cursorRow.createdAt), gt(sessionMessages.id, cursorRow.id)),
          ),
        ) as any;
      }
    }

    const rows = await db
      .select()
      .from(sessionMessages)
      .where(cursorFilter)
      .orderBy(sessionMessages.createdAt, sessionMessages.id)
      .limit(limit);

    return { messages: rows as unknown as SessionMessage[], total: Number(total) };
  },

  /**
   * Mark all session messages created at or before the message with the given
   * boundaryMessageId as compacted.  Messages beyond the boundary (newer) are
   * left intact.
   */
  async markCompacted(sessionId: string, boundaryMessageId: string): Promise<void> {
    // Resolve the createdAt timestamp of the boundary message
    const [boundary] = await db
      .select({ createdAt: sessionMessages.createdAt })
      .from(sessionMessages)
      .where(eq(sessionMessages.id, boundaryMessageId))
      .limit(1);
    if (!boundary) return;

    await db.update(sessionMessages)
      .set({ isCompacted: true })
      .where(and(
        eq(sessionMessages.sessionId, sessionId),
        lte(sessionMessages.createdAt, boundary.createdAt),
      ));
  },

  async getLatestMessage(sessionId: string): Promise<SessionMessage | null> {
    const [row] = await db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(desc(sessionMessages.createdAt))
      .limit(1);
    return row ?? null;
  },

  async expireIdleSessions(maxIdleMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxIdleMs);
    const result = await db.update(sessions)
      .set({ status: 'expired' as any, updatedAt: new Date() })
      .where(and(
        eq(sessions.status, 'active' as any),
        lt(sessions.updatedAt, cutoff),
      ));
    return (result as any).rowCount ?? 0;
  },
};
