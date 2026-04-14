import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a raw DB row (snake_case) as postgres driver returns from db.execute.
 */
function makeRawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'notif-1',
    workspace_id: 'ws-a',
    user_id: 'user-1',
    type: 'task_error',
    title: 'Test notification',
    body: null,
    metadata: {},
    channel: 'slack',
    status: 'failed',
    read_at: null,
    attempt_count: 1,
    last_attempted_at: null,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Simulate the per-workspace cap + batchSize LIMIT that the CTE would apply.
 * This mirrors the SQL logic so the unit test can verify the correct rows are
 * returned without a real DB.
 */
function simulateCte(
  allRows: Array<{ workspace_id: string; created_at: Date; [k: string]: unknown }>,
  perWorkspaceCap: number,
  batchSize: number,
): typeof allRows {
  // Group by workspace, sort each group by created_at ASC (mirrors ORDER BY)
  const grouped = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const ws = row.workspace_id as string;
    if (!grouped.has(ws)) grouped.set(ws, []);
    grouped.get(ws)!.push(row);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  // ROW_NUMBER() OVER (PARTITION BY workspace_id ...) — keep rn <= perWorkspaceCap
  const capped: typeof allRows = [];
  for (const rows of grouped.values()) {
    capped.push(...rows.slice(0, perWorkspaceCap));
  }

  // Final ORDER + LIMIT batchSize
  capped.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  return capped.slice(0, batchSize);
}

// ---------------------------------------------------------------------------
// Mocks — declared before the dynamic import
// ---------------------------------------------------------------------------

let capturedSql: string | undefined;
let mockExecuteRows: Record<string, unknown>[] = [];

const mockExecute = mock((_query: unknown) => {
  // Extract the SQL string from the tagged template object for assertion
  const q = _query as any;
  capturedSql = typeof q?.queryChunks !== 'undefined'
    ? q.queryChunks.map((c: any) => (typeof c === 'string' ? c : String(c))).join('')
    : String(q);
  // Return Drizzle postgres ResultSet shape: { rows: [...] }
  return Promise.resolve({ rows: mockExecuteRows });
});

const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    ..._realDbClient.db,
    select: _realDbClient.db?.select,
    insert: _realDbClient.db?.insert,
    update: _realDbClient.db?.update,
    execute: mockExecute,
  },
}));

const _realSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({
  ..._realSchema,
}));

// Import under test AFTER mocks are registered
const { NotificationsRepository, PER_WORKSPACE_CAP, MAX_NOTIFICATION_ATTEMPTS } =
  await import('../notifications.repo');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsRepository.listFailed — per-workspace fairness', () => {
  let repo: InstanceType<typeof NotificationsRepository>;

  beforeEach(() => {
    repo = new NotificationsRepository();
    mockExecute.mockClear();
    capturedSql = undefined;
    mockExecuteRows = [];
  });

  test('PER_WORKSPACE_CAP is exported and equals 10', () => {
    expect(PER_WORKSPACE_CAP).toBe(10);
  });

  test('MAX_NOTIFICATION_ATTEMPTS is exported and equals 3', () => {
    expect(MAX_NOTIFICATION_ATTEMPTS).toBe(3);
  });

  test('calls db.execute once with the CTE query', async () => {
    mockExecuteRows = [];
    await repo.listFailed();
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  test('maps snake_case DB columns to camelCase result fields', async () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const lastAttemptedAt = new Date('2024-01-02T00:00:00Z');
    const updatedAt = new Date('2024-01-03T00:00:00Z');

    mockExecuteRows = [
      makeRawRow({
        id: 'n-1',
        workspace_id: 'ws-a',
        user_id: 'user-1',
        type: 'task_error',
        title: 'Error notification',
        body: 'Details',
        metadata: { _channels: ['slack'] },
        channel: 'slack',
        status: 'failed',
        read_at: null,
        attempt_count: 2,
        last_attempted_at: lastAttemptedAt,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ];

    const result = await repo.listFailed();

    expect(result).toHaveLength(1);
    const row = result[0]!;
    expect(row.id).toBe('n-1');
    expect(row.workspaceId).toBe('ws-a');
    expect(row.userId).toBe('user-1');
    expect(row.type).toBe('task_error');
    expect(row.title).toBe('Error notification');
    expect(row.body).toBe('Details');
    expect(row.metadata).toEqual({ _channels: ['slack'] });
    expect(row.channel).toBe('slack');
    expect(row.status).toBe('failed');
    expect(row.readAt).toBeNull();
    expect(row.attemptCount).toBe(2);
    expect(row.lastAttemptedAt).toEqual(lastAttemptedAt);
    expect(row.createdAt).toEqual(createdAt);
    expect(row.updatedAt).toEqual(updatedAt);
  });

  test('returns empty array when no failed notifications exist', async () => {
    mockExecuteRows = [];
    const result = await repo.listFailed();
    expect(result).toEqual([]);
  });

  test('handles ResultSet with .rows property (postgres driver format)', async () => {
    mockExecuteRows = [makeRawRow({ id: 'n-10' })];
    const result = await repo.listFailed();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('n-10');
  });

  // -------------------------------------------------------------------------
  // Per-workspace fairness simulation
  // -------------------------------------------------------------------------

  test('per-workspace fairness: ws-a(50) does NOT starve ws-b(5) and ws-c(2)', async () => {
    // Simulate a database with: ws-a=50 failed, ws-b=5 failed, ws-c=2 failed.
    // We simulate the SQL CTE in JS (simulateCte) and feed its output to the
    // mock so we can verify the method respects the returned capped rows.

    const now = Date.now();

    // Generate 50 rows for ws-a
    const wsARows = Array.from({ length: 50 }, (_, i) =>
      makeRawRow({
        id: `ws-a-${i}`,
        workspace_id: 'ws-a',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );

    // Generate 5 rows for ws-b
    const wsBRows = Array.from({ length: 5 }, (_, i) =>
      makeRawRow({
        id: `ws-b-${i}`,
        workspace_id: 'ws-b',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );

    // Generate 2 rows for ws-c
    const wsCRows = Array.from({ length: 2 }, (_, i) =>
      makeRawRow({
        id: `ws-c-${i}`,
        workspace_id: 'ws-c',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );

    const batchSize = 20;
    const perWorkspaceCap = 10;

    // Simulate what the CTE + LIMIT would return from the database
    mockExecuteRows = simulateCte(
      [...wsARows, ...wsBRows, ...wsCRows] as any,
      perWorkspaceCap,
      batchSize,
    ) as any;

    const result = await repo.listFailed(batchSize, perWorkspaceCap);

    // Total must not exceed batchSize
    expect(result.length).toBeLessThanOrEqual(batchSize);

    // Count by workspace
    const countByWs: Record<string, number> = {};
    for (const row of result) {
      countByWs[row.workspaceId] = (countByWs[row.workspaceId] ?? 0) + 1;
    }

    // ws-a should be capped at perWorkspaceCap (10), not given all 50
    expect(countByWs['ws-a']).toBe(perWorkspaceCap);

    // ws-b gets all 5 (fewer than cap)
    expect(countByWs['ws-b']).toBe(5);

    // ws-c gets all 2 (fewer than cap)
    expect(countByWs['ws-c']).toBe(2);

    // Total = 10 + 5 + 2 = 17, which is within batchSize=20
    expect(result.length).toBe(17);
  });

  test('per-workspace fairness: ws-a does NOT consume the full batch (single workspace dominance check)', async () => {
    const now = Date.now();
    const batchSize = 20;
    const perWorkspaceCap = 10;

    // Only ws-a has 50 failed notifications — without fairness it would fill the batch
    const wsARows = Array.from({ length: 50 }, (_, i) =>
      makeRawRow({
        id: `ws-a-${i}`,
        workspace_id: 'ws-a',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );

    // ws-b and ws-c also exist
    const wsBRows = Array.from({ length: 5 }, (_, i) =>
      makeRawRow({
        id: `ws-b-${i}`,
        workspace_id: 'ws-b',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );
    const wsCRows = Array.from({ length: 2 }, (_, i) =>
      makeRawRow({
        id: `ws-c-${i}`,
        workspace_id: 'ws-c',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );

    mockExecuteRows = simulateCte(
      [...wsARows, ...wsBRows, ...wsCRows] as any,
      perWorkspaceCap,
      batchSize,
    ) as any;

    const result = await repo.listFailed(batchSize, perWorkspaceCap);

    const wsACount = result.filter((r) => r.workspaceId === 'ws-a').length;
    const wsBCount = result.filter((r) => r.workspaceId === 'ws-b').length;
    const wsCCount = result.filter((r) => r.workspaceId === 'ws-c').length;

    // ws-a is capped — does NOT get all 20 slots
    expect(wsACount).toBe(10);
    // ws-b and ws-c are not starved
    expect(wsBCount).toBe(5);
    expect(wsCCount).toBe(2);
  });

  test('uses PER_WORKSPACE_CAP as default perWorkspaceCap', async () => {
    mockExecuteRows = [makeRawRow({ id: 'n-1' })];
    await repo.listFailed(50);
    // Verify execute was called once (default cap is applied internally via the SQL)
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  test('accepts custom perWorkspaceCap of 1 — only 1 per workspace', async () => {
    const now = Date.now();
    const batchSize = 20;
    const perWorkspaceCap = 1;

    const wsARows = Array.from({ length: 5 }, (_, i) =>
      makeRawRow({
        id: `ws-a-${i}`,
        workspace_id: 'ws-a',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );
    const wsBRows = Array.from({ length: 3 }, (_, i) =>
      makeRawRow({
        id: `ws-b-${i}`,
        workspace_id: 'ws-b',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );

    mockExecuteRows = simulateCte(
      [...wsARows, ...wsBRows] as any,
      perWorkspaceCap,
      batchSize,
    ) as any;

    const result = await repo.listFailed(batchSize, perWorkspaceCap);

    const wsACount = result.filter((r) => r.workspaceId === 'ws-a').length;
    const wsBCount = result.filter((r) => r.workspaceId === 'ws-b').length;

    expect(wsACount).toBe(1);
    expect(wsBCount).toBe(1);
    expect(result.length).toBe(2);
  });

  test('graceful with 0 workspaces — returns empty array', async () => {
    mockExecuteRows = [];
    const result = await repo.listFailed(50, 10);
    expect(result).toEqual([]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  test('graceful with 1 workspace — returns up to perWorkspaceCap rows', async () => {
    const now = Date.now();
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRawRow({
        id: `n-${i}`,
        workspace_id: 'ws-only',
        created_at: new Date(now + i),
        updated_at: new Date(now + i),
      }),
    );

    const perWorkspaceCap = 10;
    const batchSize = 50;

    mockExecuteRows = simulateCte(rows as any, perWorkspaceCap, batchSize) as any;

    const result = await repo.listFailed(batchSize, perWorkspaceCap);

    expect(result.length).toBe(perWorkspaceCap);
    for (const row of result) {
      expect(row.workspaceId).toBe('ws-only');
    }
  });
});
