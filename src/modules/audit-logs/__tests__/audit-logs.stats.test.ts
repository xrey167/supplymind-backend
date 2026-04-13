import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Thenable query chain — handles queries with or without .groupBy()/.orderBy()/.limit()
function makeChain(data: any[]): any {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(data),
    then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
      Promise.resolve(data).then(resolve, reject),
    catch: (reject: (e: any) => any) => Promise.resolve(data).catch(reject),
  };
  return chain;
}

// getStats issues 4 parallel db.select() calls; each call pops the next queued result
let _selectQueue: any[][] = [];
let _deleteCount = 0;

mock.module('../../../infra/db/client', () => ({
  db: {
    select: () => makeChain(_selectQueue.shift() ?? []),
    delete: () => ({
      where: () => ({
        returning: () =>
          Promise.resolve(Array.from({ length: _deleteCount }, (_, i) => ({ id: `l${i}` }))),
      }),
    }),
  },
}));

const { AuditLogsRepository } = await import('../audit-logs.repo');

describe('AuditLogsRepository.getStats', () => {
  let repo: InstanceType<typeof AuditLogsRepository>;

  beforeEach(() => {
    repo = new AuditLogsRepository();
    _selectQueue = [];
    _deleteCount = 0;
  });

  function queueStats(
    summary: any[],
    byAction: any[],
    byResourceType: any[],
    byActor: any[],
  ) {
    // Promise.all order: summary, byAction, byResourceType, byActor
    _selectQueue = [summary, byAction, byResourceType, byActor];
  }

  test('empty workspace returns zero stats', async () => {
    queueStats([], [], [], []);
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
    queueStats(
      [{ total: '3', oldestAt: old.toISOString(), newestAt: now.toISOString() }],
      [{ action: 'create', count: '2' }, { action: 'update', count: '1' }],
      [{ resourceType: 'agent', count: '2' }, { resourceType: 'credential', count: '1' }],
      [{ actorId: 'u1', count: '2' }, { actorId: 'u2', count: '1' }],
    );

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

  test('byActor returned in SQL-sorted order (count desc)', async () => {
    queueStats(
      [{ total: '4', oldestAt: null, newestAt: null }],
      [],
      [],
      [{ actorId: 'b', count: '3' }, { actorId: 'a', count: '1' }],
    );

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
