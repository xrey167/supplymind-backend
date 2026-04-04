import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

export function emitSessionCreated(sessionId: string, workspaceId: string): void {
  eventBus.publish(Topics.SESSION_CREATED, { sessionId, workspaceId });
}

export function emitSessionPaused(sessionId: string, workspaceId: string, reason?: string): void {
  eventBus.publish(Topics.SESSION_PAUSED, { sessionId, workspaceId, reason });
}

export function emitSessionResumed(sessionId: string, workspaceId: string): void {
  eventBus.publish(Topics.SESSION_RESUMED, { sessionId, workspaceId });
}

export function emitSessionClosed(sessionId: string, workspaceId: string): void {
  eventBus.publish(Topics.SESSION_CLOSED, { sessionId, workspaceId });
}
