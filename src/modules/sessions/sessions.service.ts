import { sessionsRepo } from './sessions.repo';
import { compactSession, COMPACTION_THRESHOLD_TOKENS } from './compaction.service';
import { emitSessionCreated, emitSessionPaused, emitSessionResumed, emitSessionClosed } from './sessions.events';
import type { Session, SessionMessage, AddMessageInput } from './sessions.types';
import type { Message } from '../../infra/ai/types';

const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export const sessionsService = {
  async create(data: { workspaceId: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<Session> {
    const session = await sessionsRepo.create(data);
    emitSessionCreated(session.id, session.workspaceId);
    return session;
  },

  async get(id: string): Promise<Session | undefined> {
    return sessionsRepo.get(id);
  },

  async addMessage(sessionId: string, input: AddMessageInput): Promise<SessionMessage> {
    const session = await sessionsRepo.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status === 'closed' || session.status === 'expired') {
      throw new Error(`Session is ${session.status}: ${sessionId}`);
    }
    if (session.status === 'created') {
      await sessionsRepo.updateStatus(sessionId, 'active');
    }
    return sessionsRepo.addMessage(sessionId, input);
  },

  async getMessages(sessionId: string): Promise<SessionMessage[]> {
    return sessionsRepo.getMessages(sessionId);
  },

  async pause(sessionId: string, reason?: string): Promise<void> {
    const session = await sessionsRepo.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await sessionsRepo.updateStatus(sessionId, 'paused');
    emitSessionPaused(sessionId, session.workspaceId, reason);
  },

  async resume(sessionId: string): Promise<void> {
    const session = await sessionsRepo.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status !== 'paused') {
      throw new Error(`Session is not paused: ${sessionId} (status: ${session.status})`);
    }
    await sessionsRepo.updateStatus(sessionId, 'active');
    emitSessionResumed(sessionId, session.workspaceId);
  },

  async close(sessionId: string): Promise<void> {
    const session = await sessionsRepo.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await sessionsRepo.updateStatus(sessionId, 'closed');
    emitSessionClosed(sessionId, session.workspaceId);
  },

  async expireIdleSessions(maxIdleMs = DEFAULT_IDLE_TIMEOUT_MS): Promise<number> {
    return sessionsRepo.expireIdleSessions(maxIdleMs);
  },

  async getTranscript(
    sessionId: string,
    opts: { limit?: number; cursor?: string; includeCompacted?: boolean },
  ): Promise<{ messages: SessionMessage[]; nextCursor: string | null; total: number }> {
    const { messages, total } = await sessionsRepo.getMessagePage(sessionId, opts);
    const limit = opts.limit ?? 50;
    const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;
    return { messages, nextCursor, total };
  },

  async buildContextMessages(
    sessionId: string,
    opts: { workspaceId: string; sessionModel: string; _pass?: number } = { workspaceId: '', sessionModel: '' },
  ): Promise<Message[]> {
    const allMessages = await sessionsRepo.getMessages(sessionId, { limit: 1000 });
    const summaries: Message[] = [];
    const activeDbMessages: SessionMessage[] = [];

    for (const m of allMessages) {
      if (m.isCompacted && m.role === 'system') {
        summaries.push({ role: 'system', content: m.content });
      } else if (!m.isCompacted) {
        activeDbMessages.push(m);
      }
    }

    const pass = opts._pass ?? 0;
    const compactionEnabled = Bun.env.CONTEXT_COMPACTION_ENABLED === 'true';
    const activeTokens = activeDbMessages.reduce((sum, m) => sum + (m.tokenEstimate ?? 0), 0);

    if (compactionEnabled && activeTokens > COMPACTION_THRESHOLD_TOKENS && pass < 2) {
      await compactSession(sessionId, opts.workspaceId, activeDbMessages, opts.sessionModel);
      return this.buildContextMessages(sessionId, { ...opts, _pass: pass + 1 });
    }

    const active: Message[] = activeDbMessages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    }));

    return [...summaries, ...active];
  },
};
