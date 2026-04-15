import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';

const mockReturning = mock(() => Promise.resolve([{
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
}]));

const mockValues = mock(() => ({ returning: mockReturning }));
const mockOffset = mock(() => Promise.resolve([{
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
}]));
const mockLimit = mock(() => ({ offset: mockOffset }));
const mockOrderBy = mock(() => ({ limit: mockLimit }));
const mockSelectWhere = mock(() => ({ orderBy: mockOrderBy }));
const mockSelectFrom = mock(() => ({ where: mockSelectWhere }));

const mockCountWhere = mock(() => Promise.resolve([{ count: 5 }]));
const mockCountFrom = mock(() => ({ where: mockCountWhere }));

let selectCallCount = 0;

const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    insert: () => ({ values: mockValues }),
    select: (...args: any[]) => {
      selectCallCount++;
      // If called with count arg, return the count mock chain
      if (args.length > 0) {
        return { from: mockCountFrom };
      }
      return { from: mockSelectFrom };
    },
  },
}));


const { AuditLogsRepository } = await import('../audit-logs.repo');

describe('AuditLogsRepository', () => {
  let repo: InstanceType<typeof AuditLogsRepository>;

  beforeEach(() => {
    repo = new AuditLogsRepository();
    selectCallCount = 0;
  });

  test('create inserts an audit log and returns it', async () => {
    const result = await repo.create({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorType: 'user',
      action: 'create',
      resourceType: 'agent',
      resourceId: 'agent-1',
    });
    expect(result).toBeDefined();
    expect(result.id).toBe('audit-1');
    expect(result.action).toBe('create');
    expect(result.resourceType).toBe('agent');
  });

  test('create uses defaults for optional fields', async () => {
    const result = await repo.create({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorType: 'user',
      action: 'delete',
      resourceType: 'credential',
    });
    expect(result).toBeDefined();
  });

  test('list returns audit logs ordered by createdAt DESC', async () => {
    const results = await repo.list({ workspaceId: 'ws-1' });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  test('list applies filters', async () => {
    const results = await repo.list({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: 'create',
      resourceType: 'agent',
      limit: 10,
      offset: 0,
    });
    expect(Array.isArray(results)).toBe(true);
  });

  test('count returns a number', async () => {
    const count = await repo.count({ workspaceId: 'ws-1' });
    expect(typeof count).toBe('number');
    expect(count).toBe(5);
  });
});

afterAll(() => mock.restore());
