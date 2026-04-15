import { describe, test, expect, beforeEach, mock, afterAll } from 'bun:test';

// Mock the DB module before importing task-repo
// queryResult builds a thenable that also supports .orderBy().limit() for paginated queries
let _queryRows: any[] = [];
function queryResult() {
  const obj: any = {
    orderBy: (..._args: any[]) => ({
      limit: () => Promise.resolve(_queryRows),
    }),
    then: (resolve: any, reject: any) => Promise.resolve(_queryRows).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(_queryRows).catch(reject),
  };
  return obj;
}

const mockWhere = mock(() => queryResult());
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

const mockValues = mock(async () => {});
const mockInsert = mock(() => ({ values: mockValues }));

const mockWhereUpdate = mock(async () => {});
const mockSet = mock(() => ({ where: mockWhereUpdate }));
const mockUpdate = mock(() => ({ set: mockSet }));

const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
}));

// Import after mocking so the mocked db is used
const { taskRepo } = await import('../task-repo');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'task-1',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    agentId: overrides.agentId ?? 'agent-1',
    status: overrides.status ?? 'submitted',
    input: overrides.input ?? {},
    output: overrides.output ?? null,
    artifacts: overrides.artifacts !== undefined ? overrides.artifacts : null,
    history: overrides.history !== undefined ? overrides.history : null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('taskRepo.findByStatus', () => {
  beforeEach(() => {
    
    mockFrom.mockReset();
    mockSelect.mockReset();
    _queryRows = [];
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  test('returns empty array when no tasks match', async () => {
    const result = await taskRepo.findByStatus('working');
    expect(result).toEqual([]);
  });

  test('maps DB rows to A2ATask shape', async () => {
    const row = makeRow({ id: 'task-abc', status: 'working' });
    _queryRows = [row];

    const result = await taskRepo.findByStatus('working');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('task-abc');
    expect(result[0].status.state).toBe('working');
    expect(Array.isArray(result[0].artifacts)).toBe(true);
    expect(Array.isArray(result[0].history)).toBe(true);
  });

  test('maps multiple rows correctly', async () => {
    const rows = [
      makeRow({ id: 'task-1', status: 'submitted' }),
      makeRow({ id: 'task-2', status: 'submitted' }),
    ];
    _queryRows = rows;

    const result = await taskRepo.findByStatus('submitted');

    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual(['task-1', 'task-2']);
  });

  test('preserves artifacts and history from DB row when present', async () => {
    const artifacts = [{ parts: [{ kind: 'text' as const, text: 'hello' }] }];
    const history = [{ role: 'agent' as const, parts: [{ kind: 'text' as const, text: 'response' }] }];
    const row = makeRow({ id: 'task-3', status: 'completed', artifacts, history });
    _queryRows = [row];

    const result = await taskRepo.findByStatus('completed');

    expect(result[0].artifacts).toEqual(artifacts);
    expect(result[0].history).toEqual(history);
  });

  test('defaults artifacts and history to empty arrays when null in DB', async () => {
    const row = makeRow({ id: 'task-4', status: 'failed', artifacts: null, history: null });
    _queryRows = [row];

    const result = await taskRepo.findByStatus('failed');

    expect(result[0].artifacts).toEqual([]);
    expect(result[0].history).toEqual([]);
  });

  test('calls db.select().from().where() to filter by status', async () => {
    await taskRepo.findByStatus('working');
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });
});

describe('taskRepo.findByWorkspace', () => {
  beforeEach(() => {
    
    mockFrom.mockReset();
    mockSelect.mockReset();
    _queryRows = [];
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  test('with workspaceId uses where filter', async () => {
    const row = makeRow({ id: 'task-ws', workspaceId: 'ws-abc' });
    _queryRows = [row];

    const result = await taskRepo.findByWorkspace('ws-abc');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('task-ws');
    expect(mockWhere).toHaveBeenCalled();
  });

  test('invalid cursor string returns empty array without querying', async () => {
    _queryRows = [makeRow({ id: 'task-a' }), makeRow({ id: 'task-b' })];

    const result = await taskRepo.findByWorkspace('ws-abc', { cursor: 'not-a-date' });

    expect(result).toHaveLength(0);
  });
});

describe('taskRepo.findById', () => {
  beforeEach(() => {
    
    mockFrom.mockReset();
    mockSelect.mockReset();
    _queryRows = [];
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  test('returns undefined when task not found', async () => {
    const result = await taskRepo.findById('nonexistent');
    expect(result).toBeUndefined();
  });

  test('returns task when found', async () => {
    const row = makeRow({ id: 'task-found', status: 'completed' });
    _queryRows = [row];

    const result = await taskRepo.findById('task-found');

    expect(result).toBeDefined();
    expect(result?.id).toBe('task-found');
    expect(result?.status.state).toBe('completed');
  });
});

afterAll(() => mock.restore());
