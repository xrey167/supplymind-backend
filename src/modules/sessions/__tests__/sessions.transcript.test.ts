import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';
import type { Session, SessionMessage } from '../sessions.types';

const now = new Date();

const activeSession: Session = {
  id: 'sess-1',
  workspaceId: 'ws-1',
  status: 'active',
  metadata: {},
  tokenCount: 0,
  createdAt: now,
  updatedAt: now,
};

function makeMessage(id: string, isCompacted = false): SessionMessage {
  return {
    id,
    sessionId: 'sess-1',
    role: 'user',
    content: `message ${id}`,
    tokenEstimate: 5,
    isCompacted,
    createdAt: new Date(now.getTime() + parseInt(id.replace('msg-', ''), 10) * 1000),
  };
}

const repoMocks = {
  create: mock(async () => activeSession),
  get: mock(async (_id: string) => activeSession as Session | undefined),
  addMessage: mock(async () => makeMessage('msg-1')),
  getMessages: mock(async () => [makeMessage('msg-1')]),
  getMessagePage: mock(async () => ({ messages: [makeMessage('msg-1')], total: 1 })),
  updateStatus: mock(async () => undefined),
  expireIdleSessions: mock(async () => 0),
};

const eventMocks = {
  emitSessionCreated: mock(() => {}),
  emitSessionPaused: mock(() => {}),
  emitSessionResumed: mock(() => {}),
  emitSessionClosed: mock(() => {}),
};

mock.module('../sessions.repo', () => ({ sessionsRepo: repoMocks }));
mock.module('../sessions.events', () => eventMocks);

import { sessionsService } from '../sessions.service';

describe('sessionsService.getTranscript', () => {
  beforeEach(() => {
    Object.values(repoMocks).forEach(m => m.mockClear());
    repoMocks.get.mockImplementation(async () => activeSession);
  });

  test('returns messages and total from repo', async () => {
    const msgs = [makeMessage('msg-1'), makeMessage('msg-2')];
    repoMocks.getMessagePage.mockImplementationOnce(async () => ({ messages: msgs, total: 2 }));

    const result = await sessionsService.getTranscript('sess-1', { limit: 50 });

    expect(result.messages).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(repoMocks.getMessagePage).toHaveBeenCalledWith('sess-1', { limit: 50 });
  });

  test('nextCursor is null when fewer messages than limit', async () => {
    repoMocks.getMessagePage.mockImplementationOnce(async () => ({
      messages: [makeMessage('msg-1'), makeMessage('msg-2')],
      total: 2,
    }));

    const result = await sessionsService.getTranscript('sess-1', { limit: 50 });

    expect(result.nextCursor).toBeNull();
  });

  test('nextCursor is set when message count equals limit', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) => makeMessage(`msg-${i + 1}`));
    repoMocks.getMessagePage.mockImplementationOnce(async () => ({ messages: msgs, total: 20 }));

    const result = await sessionsService.getTranscript('sess-1', { limit: 10 });

    expect(result.nextCursor).toBe('msg-10');
  });

  test('nextCursor uses default limit of 50', async () => {
    const msgs = Array.from({ length: 50 }, (_, i) => makeMessage(`msg-${i + 1}`));
    repoMocks.getMessagePage.mockImplementationOnce(async () => ({ messages: msgs, total: 100 }));

    const result = await sessionsService.getTranscript('sess-1', {});

    expect(result.nextCursor).toBe('msg-50');
  });

  test('passes includeCompacted option to repo', async () => {
    repoMocks.getMessagePage.mockImplementationOnce(async () => ({ messages: [], total: 0 }));

    await sessionsService.getTranscript('sess-1', { includeCompacted: true });

    expect(repoMocks.getMessagePage).toHaveBeenCalledWith('sess-1', { includeCompacted: true });
  });

  test('includeCompacted=false excludes compacted messages via repo call', async () => {
    const nonCompacted = [makeMessage('msg-1', false), makeMessage('msg-2', false)];
    repoMocks.getMessagePage.mockImplementationOnce(async () => ({
      messages: nonCompacted,
      total: 2,
    }));

    const result = await sessionsService.getTranscript('sess-1', { includeCompacted: false });

    expect(result.messages.every(m => !m.isCompacted)).toBe(true);
  });

  test('passes cursor option to repo', async () => {
    repoMocks.getMessagePage.mockImplementationOnce(async () => ({ messages: [], total: 5 }));

    await sessionsService.getTranscript('sess-1', { cursor: 'msg-3', limit: 2 });

    expect(repoMocks.getMessagePage).toHaveBeenCalledWith('sess-1', { cursor: 'msg-3', limit: 2 });
  });
});

afterAll(() => mock.restore());
