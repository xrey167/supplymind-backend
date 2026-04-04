import { sessionsRepo } from './sessions.repo';
import { emitSessionCreated, emitSessionPaused, emitSessionResumed, emitSessionClosed } from './sessions.events';
import type { Session, SessionMessage, AddMessageInput } from './sessions.types';

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
};
