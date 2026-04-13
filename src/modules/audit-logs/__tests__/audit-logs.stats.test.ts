import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { AuditLog } from '../audit-logs.types';

// Mutable store so each test can set what db returns — no schema or drizzle-orm mocks needed
// since the mock db intercepts the whole query chain before drizzle operates on it.
let _rows: any[] = [];
let _deleteCount = 0;

mock.module('../../../infra/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(_rows) }) }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(Array.from({ length: _deleteCount }, (_, i) => ({ id: `l${i}` }))),
      }),
    }),
  },
}));

const { AuditLogsRepository } = await import('../audit-logs.repo');

const makeLog = (overrides: Partial<AuditLog> = {}): AuditLog => ({
  id: 'l1',
  workspaceId: 'ws-1',
  actorId: 'user-1',
  actorType: 'user',
  action: 'create',
  resourceType: 'agent',
  resourceId: null,
  metadata: {},
  ipAddress: null,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  ...overrides,
});

describe('AuditLogsRepository.getStats', () => {
  let repo: InstanceType<typeof AuditLogsRepository>;

  beforeEach(() => {
    repo = new AuditLogsRepository();
    _rows = [];
    _deleteCount = 0;
  });

  test('empty workspace returns zero stats', async () => {
    const result = await repo.getStats('ws-1');
    expect(result.total).toBe(0);
    expect(result.byAction).toEqual({});
    expect(result.byResourceType).toEqual({});
    expect(result.byActor).toEqual([]);
    expect(result.oldestAt).toBeNull();
    expect(result.newestAt).toBeNull();
  });

  test('aggregates counts correctly', async () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-15T12:00:00Z');
    _rows = [
      makeLog({ actorId: 'u1', action: 'create', resourceType: 'agent', createdAt: old }),
      makeLog({ actorId: 'u1', action: 'update', resourceType: 'agent', createdAt: now }),
      makeLog({ actorId: 'u2', action: 'create', resourceType: 'credential', createdAt: now }),
    ];

    const result = await repo.getStats('ws-1');
    expect(result.total).toBe(3);
    expect(result.byAction['create']).toBe(2);
    expect(result.byAction['update']).toBe(1);
    expect(result.byResourceType['agent']).toBe(2);
    expect(result.byResourceType['credential']).toBe(1);
    expect(result.byActor[0]!.actorId).toBe('u1');
    expect(result.byActor[0]!.count).toBe(2);
    expect(result.oldestAt).toEqual(old);
    expect(result.newestAt).toEqual(now);
  });

  test('byActor sorted descending by count', async () => {
    _rows = [
      makeLog({ actorId: 'a', action: 'create', resourceType: 'agent' }),
      makeLog({ actorId: 'b', action: 'create', resourceType: 'agent' }),
      makeLog({ actorId: 'b', action: 'update', resourceType: 'agent' }),
      makeLog({ actorId: 'b', action: 'delete', resourceType: 'agent' }),
    ];

    const result = await repo.getStats('ws-1');
    expect(result.byActor[0]!.actorId).toBe('b');
    expect(result.byActor[0]!.count).toBe(3);
    expect(result.byActor[1]!.actorId).toBe('a');
    expect(result.byActor[1]!.count).toBe(1);
  });

  test('deleteOlderThan returns deleted count', async () => {
    _deleteCount = 5;
    const count = await repo.deleteOlderThan(new Date());
    expect(count).toBe(5);
  });
});
