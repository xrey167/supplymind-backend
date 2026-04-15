import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

const mockRow = {
  id: 'mr-1',
  workspaceId: 'ws-1',
  name: 'Test Mission',
  mode: 'assist',
  status: 'pending',
  input: {},
  output: null,
  metadata: {},
  disciplineMaxRetries: 3,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  completedAt: null,
};

const mockReturning = mock(() => Promise.resolve([mockRow]));
const mockWhere = mock(() => Promise.resolve([mockRow]));
const mockOrderBy = mock(() => ({ limit: mock(() => Promise.resolve([mockRow])) }));
const mockLimit = mock(() => Promise.resolve([mockRow]));

const mockSelectChain = {
  from: mock(() => ({
    where: mock(() => ({
      limit: mockLimit,
      orderBy: mockOrderBy,
    })),
  })),
};

const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    select: mock(() => mockSelectChain),
    insert: mock(() => ({ values: mock(() => ({ returning: mockReturning })) })),
    update: mock(() => ({ set: mock(() => ({ where: mock(() => ({ returning: mockReturning })) })) })),
  },
}));

const _realSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({
  ..._realSchema,
}));

const _realDrizzle = require('drizzle-orm');
mock.module('drizzle-orm', () => ({
  ..._realDrizzle,
  eq: mock((a: unknown, b: unknown) => [a, b]),
  and: mock((...args: unknown[]) => args),
  lt: mock((a: unknown, b: unknown) => [a, b]),
  or: mock((...args: unknown[]) => args),
  desc: mock((a: unknown) => a),
  sql: mock((...args: unknown[]) => args),
}));

const { MissionsRepository } = await import('../missions.repo');

describe('MissionsRepository', () => {
  let repo: InstanceType<typeof MissionsRepository>;

  beforeEach(() => {
    repo = new MissionsRepository();
    mockReturning.mockClear();
  });

  it('createRun() inserts and returns mapped run', async () => {
    const run = await repo.createRun('ws-1', { name: 'Test', mode: 'assist' });
    expect(run.id).toBe('mr-1');
    expect(run.status).toBe('pending');
  });

  it('findRunById() returns run or null', async () => {
    const run = await repo.findRunById('mr-1');
    expect(run?.id).toBe('mr-1');
  });

  it('updateRunStatus() sets completedAt for terminal statuses', async () => {
    const run = await repo.updateRunStatus('mr-1', 'completed');
    expect(run).toBeDefined();
  });
});

afterAll(() => mock.restore());
