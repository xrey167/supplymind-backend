import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';
import type { Session, SessionMessage } from '../sessions.types';

const now = new Date();

const activeSession: Session = { id: 'sess-1', workspaceId: 'ws-1', status: 'active', metadata: {}, tokenCount: 0, createdAt: now, updatedAt: now };
const pausedSession: Session = { ...activeSession, status: 'paused' };
const createdSession: Session = { ...activeSession, status: 'created' };
const closedSession: Session = { ...activeSession, status: 'closed' };

const mockMessage: SessionMessage = {
  id: 'msg-1', sessionId: 'sess-1', role: 'user', content: 'hello',
  tokenEstimate: 2, isCompacted: false, createdAt: now,
};

const repoMocks = {
  create: mock(async () => createdSession),
  get: mock(async (_id: string) => activeSession as Session | undefined),
  addMessage: mock(async () => mockMessage),
  getMessages: mock(async () => [mockMessage]),
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

describe('sessionsService', () => {
  beforeEach(() => {
    // Clear call history but keep implementations
    Object.values(repoMocks).forEach(m => m.mockClear());
    Object.values(eventMocks).forEach(m => m.mockClear());
    // Reset default return values
    repoMocks.get.mockImplementation(async () => activeSession);
    repoMocks.create.mockImplementation(async () => createdSession);
    repoMocks.addMessage.mockImplementation(async () => mockMessage);
    repoMocks.expireIdleSessions.mockImplementation(async () => 0);
  });

  test('create returns a session and emits event', async () => {
    const session = await sessionsService.create({ workspaceId: 'ws-1' });
    expect(session.id).toBe('sess-1');
    expect(eventMocks.emitSessionCreated).toHaveBeenCalledWith('sess-1', 'ws-1');
  });

  test('get returns session by id', async () => {
    const session = await sessionsService.get('sess-1');
    expect(session).toBeDefined();
    expect(repoMocks.get).toHaveBeenCalledWith('sess-1');
  });

  test('close throws for missing session', async () => {
    repoMocks.get.mockImplementationOnce(async () => undefined);
    await expect(sessionsService.close('nonexistent')).rejects.toThrow('Session not found');
  });

  test('resume throws when session is not paused', async () => {
    await expect(sessionsService.resume('sess-1')).rejects.toThrow('not paused');
  });

  test('resume throws for missing session', async () => {
    repoMocks.get.mockImplementationOnce(async () => undefined);
    await expect(sessionsService.resume('nonexistent')).rejects.toThrow('Session not found');
  });

  test('resume resolves when session is paused', async () => {
    repoMocks.get.mockImplementationOnce(async () => pausedSession);
    await expect(sessionsService.resume('sess-1')).resolves.toBeUndefined();
    expect(repoMocks.updateStatus).toHaveBeenCalledWith('sess-1', 'active');
    expect(eventMocks.emitSessionResumed).toHaveBeenCalledWith('sess-1', 'ws-1');
  });

  test('addMessage throws for closed session', async () => {
    repoMocks.get.mockImplementationOnce(async () => closedSession);
    await expect(
      sessionsService.addMessage('sess-1', { role: 'user', content: 'hi' }),
    ).rejects.toThrow('closed');
  });

  test('addMessage throws for missing session', async () => {
    repoMocks.get.mockImplementationOnce(async () => undefined);
    await expect(
      sessionsService.addMessage('nonexistent', { role: 'user', content: 'hi' }),
    ).rejects.toThrow('Session not found');
  });

  test('addMessage returns message with token estimate', async () => {
    const msg = await sessionsService.addMessage('sess-1', { role: 'user', content: 'hello' });
    expect(msg.id).toBe('msg-1');
    expect(msg.tokenEstimate).toBe(2);
    expect(repoMocks.addMessage).toHaveBeenCalledTimes(1);
  });

  test('addMessage activates a created session', async () => {
    repoMocks.get.mockImplementationOnce(async () => createdSession);
    await sessionsService.addMessage('sess-1', { role: 'user', content: 'hi' });
    expect(repoMocks.updateStatus).toHaveBeenCalledWith('sess-1', 'active');
  });

  test('expireIdleSessions returns count', async () => {
    repoMocks.expireIdleSessions.mockImplementationOnce(async () => 3);
    const count = await sessionsService.expireIdleSessions(60_000);
    expect(count).toBe(3);
  });

  test('expireIdleSessions uses default timeout', async () => {
    await sessionsService.expireIdleSessions();
    expect(repoMocks.expireIdleSessions).toHaveBeenCalledTimes(1);
  });

  test('pause emits event', async () => {
    await sessionsService.pause('sess-1', 'user request');
    expect(repoMocks.updateStatus).toHaveBeenCalledWith('sess-1', 'paused');
    expect(eventMocks.emitSessionPaused).toHaveBeenCalledWith('sess-1', 'ws-1', 'user request');
  });
});

afterAll(() => mock.restore());
