import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test';

// --- Fixtures ---

const PROPOSAL_ID = '00000000-0000-0000-0000-000000000001';
const WORKSPACE_ID = 'ws-1';

const pendingRow = {
  id: PROPOSAL_ID,
  workspaceId: WORKSPACE_ID,
  pluginId: null,
  proposalType: 'skill_weight',
  changeType: 'behavioral',
  description: 'Lower priority for failing skill',
  evidence: ['high failure rate'],
  beforeValue: { skillId: 'sk-1', priority: 10 },
  afterValue: { skillId: 'sk-1', priority: 5 },
  confidence: 0.8,
  status: 'pending',
  rollbackData: null,
  autoAppliedAt: null,
  approvedAt: null,
  rejectedAt: null,
  createdAt: new Date('2026-01-01'),
};

const approvedRow = { ...pendingRow, status: 'approved', rollbackData: { skillId: 'sk-1', priority: 10 } };
const autoAppliedRow = { ...pendingRow, status: 'auto_applied', rollbackData: { skillId: 'sk-1', priority: 10 } };
const rejectedRow = { ...pendingRow, status: 'rejected' };

// --- Chainable DB mock ---
// Each chain is a proxy that records calls and resolves with configured rows
// at the terminal method (.limit(), .orderBy(), .returning(), last .where() on update).

/** Build a new select chain that always resolves `rows` at terminal methods. */
function makeSelectChain(rows: any[]) {
  const chain: any = {};
  chain.from = mock(() => chain);
  chain.where = mock(() => chain);
  chain.limit = mock(() => Promise.resolve(rows));
  chain.orderBy = mock(() => Promise.resolve(rows));
  return chain;
}

function makeInsertChain(returning: any[] = [{ id: PROPOSAL_ID }]) {
  const chain: any = {};
  chain.values = mock(() => chain);
  chain.returning = mock(() => Promise.resolve(returning));
  return chain;
}

function makeUpdateChain() {
  const chain: any = {};
  chain.set = mock(() => chain);
  chain.where = mock(() => Promise.resolve());
  return chain;
}

// Queues of chains to serve; each db.select/insert/update call shifts the next.
let selectQueue: any[] = [];
let insertQueue: any[] = [];
let updateQueue: any[] = [];

const mockDb = {
  select: mock((..._args: any[]) => {
    return selectQueue.length > 0 ? selectQueue.shift() : makeSelectChain([]);
  }),
  insert: mock((..._args: any[]) => {
    return insertQueue.length > 0 ? insertQueue.shift() : makeInsertChain();
  }),
  update: mock((..._args: any[]) => {
    return updateQueue.length > 0 ? updateQueue.shift() : makeUpdateChain();
  }),
};

mock.module('../../../infra/db/client', () => ({ db: mockDb }));

// Spread the real bus so eventBus.subscribe is preserved for downstream test files
// (notification.handler.test.ts wraps it in a proxy that intercepts subscribe).
const _realBus = require('../../../events/bus');
const mockPublish = mock(async () => undefined);
mock.module('../../../events/bus', () => ({
  ..._realBus,
  eventBus: new Proxy(_realBus.eventBus, {
    get(target: any, prop: string | symbol) {
      if (prop === 'publish') return (...args: any[]) => mockPublish(...args);
      return target[prop];
    },
  }),
}));

// Do NOT mock events/topics — it's just string constants and mocking it
// globally stomps Topics used by other test files (e.g. TASK_COMPLETED).

mock.module('../../../config/logger', () => ({
  logger: {
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    debug: mock(() => undefined),
  },
}));

// improvement-pipeline.ts only uses skillRegistry and generators via dynamic
// import() inside applyChange/applyRollback for specific proposal types. The
// tests below only cover 'skill_weight' proposals (skillRegistry.get returns
// undefined → noop branch) and CRUD operations, so no mocking is needed here.
// Avoiding mock.module for these modules prevents contamination of downstream
// test files (skills dispatch, tools registry, memory skills, generators).
mock.module('../../settings/workspace-settings/workspace-settings.service', () => ({
  workspaceSettingsService: {
    set: mock(async () => undefined),
    getRaw: mock(async () => null),
  },
}));

// --- Import SUT after mocks ---

const { ImprovementPipeline } = await import('../improvement-pipeline');

// --- Tests ---

describe('ImprovementPipeline', () => {
  let pipeline: InstanceType<typeof ImprovementPipeline>;

  beforeEach(() => {
    pipeline = new ImprovementPipeline();
    selectQueue = [];
    insertQueue = [];
    updateQueue = [];
    mockPublish.mockClear();
    mockDb.select.mockClear();
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
  });

  describe('create()', () => {
    test('inserts a proposal and returns its ID', async () => {
      insertQueue.push(makeInsertChain([{ id: PROPOSAL_ID }]));

      const id = await pipeline.create({
        workspaceId: WORKSPACE_ID,
        proposalType: 'skill_weight',
        changeType: 'behavioral',
        description: 'lower priority',
        evidence: ['high failure rate'],
        beforeValue: { skillId: 'sk-1', priority: 10 },
        afterValue: { skillId: 'sk-1', priority: 5 },
        confidence: 0.8,
      });

      expect(id).toBe(PROPOSAL_ID);
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('approve()', () => {
    test('approves a pending proposal and publishes event', async () => {
      // approve: select (find proposal with workspace check) -> update (set approved) -> applyChange -> publish
      selectQueue.push(makeSelectChain([pendingRow]));
      updateQueue.push(makeUpdateChain());

      await pipeline.approve(PROPOSAL_ID, WORKSPACE_ID);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish.mock.calls[0][0]).toBe('learning.proposal.approved');
    });

    test('throws if proposal is not pending', async () => {
      selectQueue.push(makeSelectChain([approvedRow]));

      await expect(pipeline.approve(PROPOSAL_ID, WORKSPACE_ID)).rejects.toThrow('not pending');
    });

    test('throws if proposal not found', async () => {
      selectQueue.push(makeSelectChain([]));

      await expect(pipeline.approve(PROPOSAL_ID, WORKSPACE_ID)).rejects.toThrow('not found');
    });

    test('throws not found when workspaceId does not match (IDOR check)', async () => {
      // SELECT returns empty (workspace filter excludes the row)
      selectQueue.push(makeSelectChain([]));

      await expect(pipeline.approve(PROPOSAL_ID, 'wrong-workspace')).rejects.toThrow('not found');
    });
  });

  describe('reject()', () => {
    test('publishes LEARNING_PROPOSAL_REJECTED event', async () => {
      // reject (SELECT-then-UPDATE): select (find with workspace check) -> update (set rejected) -> publish
      selectQueue.push(makeSelectChain([pendingRow]));
      updateQueue.push(makeUpdateChain());

      await pipeline.reject(PROPOSAL_ID, WORKSPACE_ID);

      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish.mock.calls[0][0]).toBe('learning.proposal.rejected');
      expect(mockPublish.mock.calls[0][1]).toMatchObject({
        proposalId: PROPOSAL_ID,
        workspaceId: WORKSPACE_ID,
        proposalType: 'skill_weight',
      });
    });

    test('throws not found when proposal does not exist', async () => {
      selectQueue.push(makeSelectChain([]));

      await expect(pipeline.reject(PROPOSAL_ID, WORKSPACE_ID)).rejects.toThrow('not found');
    });

    test('throws not found when workspaceId does not match (IDOR check)', async () => {
      // SELECT returns empty (workspace filter excludes the row)
      selectQueue.push(makeSelectChain([]));

      await expect(pipeline.reject(PROPOSAL_ID, 'wrong-workspace')).rejects.toThrow('not found');
    });
  });

  describe('rollback()', () => {
    test('rolls back an approved proposal', async () => {
      selectQueue.push(makeSelectChain([approvedRow]));
      updateQueue.push(makeUpdateChain()); // applyRollback update (if any)
      updateQueue.push(makeUpdateChain()); // status -> rolled_back

      await pipeline.rollback(PROPOSAL_ID, WORKSPACE_ID);

      expect(mockDb.update).toHaveBeenCalled();
    });

    test('rolls back an auto_applied proposal', async () => {
      selectQueue.push(makeSelectChain([autoAppliedRow]));
      updateQueue.push(makeUpdateChain());
      updateQueue.push(makeUpdateChain());

      await pipeline.rollback(PROPOSAL_ID, WORKSPACE_ID);

      expect(mockDb.update).toHaveBeenCalled();
    });

    test('throws if proposal is pending', async () => {
      selectQueue.push(makeSelectChain([pendingRow]));

      await expect(pipeline.rollback(PROPOSAL_ID, WORKSPACE_ID)).rejects.toThrow('Cannot rollback');
    });

    test('throws if proposal is rejected', async () => {
      selectQueue.push(makeSelectChain([rejectedRow]));

      await expect(pipeline.rollback(PROPOSAL_ID, WORKSPACE_ID)).rejects.toThrow('Cannot rollback');
    });

    test('throws if proposal not found', async () => {
      selectQueue.push(makeSelectChain([]));

      await expect(pipeline.rollback(PROPOSAL_ID, WORKSPACE_ID)).rejects.toThrow('not found');
    });

    test('throws not found when workspaceId does not match (IDOR check)', async () => {
      // SELECT returns empty (workspace filter excludes the row)
      selectQueue.push(makeSelectChain([]));

      await expect(pipeline.rollback(PROPOSAL_ID, 'wrong-workspace')).rejects.toThrow('not found');
    });
  });

  describe('autoApply()', () => {
    test('auto-applies a proposal and publishes event', async () => {
      // autoApply: select (find) -> update (auto_applied) -> applyChange -> publish
      selectQueue.push(makeSelectChain([pendingRow]));
      updateQueue.push(makeUpdateChain()); // set auto_applied

      await pipeline.autoApply(PROPOSAL_ID);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish.mock.calls[0][0]).toBe('learning.proposal.applied');
      expect(mockPublish.mock.calls[0][1]).toMatchObject({ autoApplied: true });
    });

    test('throws if proposal not found', async () => {
      selectQueue.push(makeSelectChain([]));

      await expect(pipeline.autoApply(PROPOSAL_ID)).rejects.toThrow('not found');
    });
  });

  describe('listPending()', () => {
    test('queries by workspace and returns rows', async () => {
      const rows = [pendingRow, { ...pendingRow, id: 'id-2' }];
      selectQueue.push(makeSelectChain(rows));

      const result = await pipeline.listPending(WORKSPACE_ID);

      expect(result).toEqual(rows);
      expect(mockDb.select).toHaveBeenCalled();
    });

    test('filters by status=pending (pending-only case)', async () => {
      // The WHERE clause includes status='pending'; the mock returns what we give it.
      // We verify the db.select was called (the actual SQL filter is in the WHERE clause).
      const rows = [pendingRow];
      selectQueue.push(makeSelectChain(rows));

      const result = await pipeline.listPending(WORKSPACE_ID);

      expect(result).toEqual(rows);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('getById()', () => {
    test('returns proposal when found', async () => {
      selectQueue.push(makeSelectChain([pendingRow]));

      const result = await pipeline.getById(PROPOSAL_ID, WORKSPACE_ID);

      expect(result).toEqual(pendingRow);
    });

    test('returns null when not found', async () => {
      selectQueue.push(makeSelectChain([]));

      const result = await pipeline.getById(PROPOSAL_ID, WORKSPACE_ID);

      expect(result).toBeNull();
    });

    test('returns null when workspaceId does not match (IDOR check)', async () => {
      // SELECT returns empty (workspace filter excludes the row)
      selectQueue.push(makeSelectChain([]));

      const result = await pipeline.getById(PROPOSAL_ID, 'wrong-workspace');

      expect(result).toBeNull();
    });
  });

  describe('listFiltered()', () => {
    test('returns all proposals for workspace when no filters', async () => {
      const rows = [pendingRow, approvedRow];
      selectQueue.push(makeSelectChain(rows));

      const result = await pipeline.listFiltered(WORKSPACE_ID);

      expect(result).toEqual(rows);
    });

    test('applies status filter', async () => {
      selectQueue.push(makeSelectChain([pendingRow]));

      const result = await pipeline.listFiltered(WORKSPACE_ID, { status: 'pending' });

      expect(result).toEqual([pendingRow]);
    });

    test('applies proposalType filter', async () => {
      selectQueue.push(makeSelectChain([pendingRow]));

      const result = await pipeline.listFiltered(WORKSPACE_ID, { proposalType: 'skill_weight' });

      expect(result).toEqual([pendingRow]);
    });

    test('applies since filter', async () => {
      const since = new Date('2025-01-01');
      selectQueue.push(makeSelectChain([pendingRow]));

      const result = await pipeline.listFiltered(WORKSPACE_ID, { since });

      expect(result).toEqual([pendingRow]);
    });
  });
});

afterAll(() => mock.restore());
