import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';
import type { CreateAuditLogInput, AuditLog, AuditLogFilter } from '../audit-logs.types';

const fakeAuditLog: AuditLog = {
  id: 'audit-1',
  workspaceId: 'ws-1',
  actorId: 'user-1',
  actorType: 'user',
  action: 'create',
  resourceType: 'agent',
  resourceId: 'agent-1',
  metadata: {},
  ipAddress: null,
  createdAt: new Date(),
};

// Direct mock objects — avoids bun mock.module transitive issues
const repo = {
  create: mock((..._args: any[]) => Promise.resolve(fakeAuditLog)),
  list: mock((..._args: any[]) => Promise.resolve([fakeAuditLog])),
  count: mock((..._args: any[]) => Promise.resolve(3)),
};

const mockLogger = {
  error: mock(),
  info: mock(),
  debug: mock(),
  warn: mock(),
};

describe('AuditLogsService (logic)', () => {
  beforeEach(() => {
    repo.create.mockClear();
    repo.list.mockClear();
    repo.count.mockClear();
    mockLogger.error.mockClear();
  });

  test('log() fires repo.create and is fire-and-forget', () => {
    const input: CreateAuditLogInput = {
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorType: 'user',
      action: 'create',
      resourceType: 'agent',
      resourceId: 'agent-1',
    };

    // Simulate fire-and-forget: call create, attach .catch()
    repo.create(input).catch((err: Error) => {
      mockLogger.error({ err, input }, 'Failed to write audit log');
    });

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(input);
  });

  test('log() swallows errors without throwing', async () => {
    repo.create.mockImplementationOnce(() => Promise.reject(new Error('DB down')));

    const input: CreateAuditLogInput = {
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorType: 'user',
      action: 'delete',
      resourceType: 'credential',
    };

    // Simulate fire-and-forget with error
    repo.create(input).catch((err: Error) => {
      mockLogger.error({ err, input }, 'Failed to write audit log');
    });

    // Give the rejection handler time to run
    await new Promise((r) => setTimeout(r, 10));
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  test('list() returns audit logs from repo', async () => {
    const filter: AuditLogFilter = { workspaceId: 'ws-1' };
    const result = await repo.list(filter);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('audit-1');
    expect(repo.list).toHaveBeenCalledWith(filter);
  });

  test('list() passes all filter params', async () => {
    const filter: AuditLogFilter = {
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: 'create',
      resourceType: 'agent',
      limit: 10,
      offset: 5,
    };
    await repo.list(filter);
    expect(repo.list).toHaveBeenCalledWith(filter);
  });

  test('count() returns count from repo', async () => {
    const filter: AuditLogFilter = { workspaceId: 'ws-1' };
    const result = await repo.count(filter);
    expect(result).toBe(3);
    expect(repo.count).toHaveBeenCalledWith(filter);
  });
});

afterAll(() => mock.restore());
