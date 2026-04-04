import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockReturning = mock(() => [{ id: 'sess-1', workspaceId: 'ws-1', status: 'created', metadata: {}, tokenCount: 0, createdAt: new Date(), updatedAt: new Date() }]);
const mockValues = mock(() => ({ returning: mockReturning }));
const mockInsert = mock(() => ({ values: mockValues }));
const mockLimit = mock(() => [{ id: 'sess-1', workspaceId: 'ws-1', status: 'active', metadata: {}, tokenCount: 0, createdAt: new Date(), updatedAt: new Date() }]);
const mockWhere = mock(() => ({ limit: mockLimit, orderBy: mock(() => ({ limit: mock(() => []) })) }));
const mockSelect = mock(() => ({ from: mock(() => ({ where: mockWhere })) }));
const mockSet = mock(() => ({ where: mock(() => ({})) }));
const mockUpdate = mock(() => ({ set: mockSet }));

mock.module('../../../infra/db/client', () => ({
  db: { insert: mockInsert, select: mockSelect, update: mockUpdate },
}));

mock.module('../../../infra/db/schema', () => ({
  sessions: {},
  sessionMessages: { sessionId: {}, createdAt: {}, isCompacted: {} },
}));

mock.module('drizzle-orm', () => ({
  eq: (...args: unknown[]) => args,
  and: (...args: unknown[]) => args,
  desc: (col: unknown) => col,
  lt: (...args: unknown[]) => args,
}));

import { sessionsService } from '../sessions.service';

describe('sessionsService', () => {
  test('create returns a session', async () => {
    const session = await sessionsService.create({ workspaceId: 'ws-1' });
    expect(session.id).toBe('sess-1');
    expect(session.workspaceId).toBe('ws-1');
  });

  test('get returns session by id', async () => {
    const session = await sessionsService.get('sess-1');
    expect(session).toBeDefined();
  });

  test('close throws for missing session', async () => {
    mockLimit.mockReturnValueOnce([]);
    await expect(sessionsService.close('nonexistent')).rejects.toThrow('Session not found');
  });
});
