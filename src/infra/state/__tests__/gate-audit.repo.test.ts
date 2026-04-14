import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock the db client — intercept insert/select calls
// ---------------------------------------------------------------------------

const mockValues = mock(async (_data: unknown) => undefined);
const mockInsert = mock(() => ({ values: mockValues }));

const mockOrderBy = mock(async (..._args: unknown[]) => []);
const mockWhere = mock(() => ({ orderBy: mockOrderBy }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

mock.module('../../../infra/db/client', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

// Mock schema — expose a minimal gateAuditLog stub
mock.module('../../../infra/db/schema', () => ({
  gateAuditLog: { orchestrationId: 'orchestration_id', decidedAt: 'decided_at' },
}));

// Mock drizzle-orm helpers — return identity values
mock.module('drizzle-orm', () => ({
  eq: (_col: unknown, val: unknown) => ({ col: _col, val }),
  desc: (_col: unknown) => ({ desc: _col }),
}));

// ---------------------------------------------------------------------------
// Import module AFTER mocks are registered
// ---------------------------------------------------------------------------
const { gateAuditRepo } = await import('../gate-audit.repo');

function resetMocks() {
  mockValues.mockReset();
  mockInsert.mockReset();
  mockOrderBy.mockReset();
  mockWhere.mockReset();
  mockFrom.mockReset();
  mockSelect.mockReset();

  // Reinstall default implementations
  mockValues.mockImplementation(async (_data: unknown) => undefined);
  mockInsert.mockImplementation(() => ({ values: mockValues }));
  mockOrderBy.mockImplementation(async (..._args: unknown[]) => []);
  mockWhere.mockImplementation(() => ({ orderBy: mockOrderBy }));
  mockFrom.mockImplementation(() => ({ where: mockWhere }));
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gateAuditRepo', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('insert()', () => {
    it('calls db.insert with correct fields for approved outcome', async () => {
      await gateAuditRepo.insert({
        orchestrationId: 'orch-1',
        stepId: 'step-1',
        workspaceId: 'ws-uuid-1',
        outcome: 'approved',
        decidedBy: 'user-123',
        prompt: 'Please approve this action',
      });

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockValues).toHaveBeenCalledTimes(1);

      const insertedData = mockValues.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedData.orchestrationId).toBe('orch-1');
      expect(insertedData.stepId).toBe('step-1');
      expect(insertedData.workspaceId).toBe('ws-uuid-1');
      expect(insertedData.outcome).toBe('approved');
      expect(insertedData.decidedBy).toBe('user-123');
      expect(insertedData.prompt).toBe('Please approve this action');
      expect(insertedData.reason).toBeNull();
    });

    it('calls db.insert with correct fields for rejected outcome', async () => {
      await gateAuditRepo.insert({
        orchestrationId: 'orch-2',
        stepId: 'step-2',
        workspaceId: 'ws-uuid-2',
        outcome: 'rejected',
        decidedBy: 'user-456',
      });

      expect(mockValues).toHaveBeenCalledTimes(1);
      const insertedData = mockValues.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedData.outcome).toBe('rejected');
      expect(insertedData.decidedBy).toBe('user-456');
      expect(insertedData.prompt).toBeNull();
      expect(insertedData.reason).toBeNull();
    });

    it('calls db.insert with correct fields for timeout outcome (system)', async () => {
      await gateAuditRepo.insert({
        orchestrationId: 'orch-3',
        stepId: 'step-3',
        workspaceId: 'ws-uuid-3',
        outcome: 'timeout',
        decidedBy: 'system',
        prompt: 'Timed out gate',
      });

      expect(mockValues).toHaveBeenCalledTimes(1);
      const insertedData = mockValues.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedData.outcome).toBe('timeout');
      expect(insertedData.decidedBy).toBe('system');
      expect(insertedData.prompt).toBe('Timed out gate');
    });

    it('sets null for optional fields when not provided', async () => {
      await gateAuditRepo.insert({
        orchestrationId: 'orch-null',
        stepId: 'step-null',
        workspaceId: 'ws-uuid-null',
        outcome: 'timeout',
      });

      const insertedData = mockValues.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedData.decidedBy).toBeNull();
      expect(insertedData.prompt).toBeNull();
      expect(insertedData.reason).toBeNull();
    });

    it('errors thrown by db.insert propagate to caller (caller must use .catch)', async () => {
      mockValues.mockImplementation(async () => { throw new Error('DB insert failed'); });

      await expect(gateAuditRepo.insert({
        orchestrationId: 'orch-err',
        stepId: 'step-err',
        workspaceId: 'ws-uuid-err',
        outcome: 'approved',
      })).rejects.toThrow('DB insert failed');
    });

    it('fire-and-forget pattern: insert error is catchable', async () => {
      mockValues.mockImplementation(async () => { throw new Error('transient DB error'); });

      // Simulate fire-and-forget calling pattern — error must not propagate
      let caught: unknown = null;
      gateAuditRepo.insert({
        orchestrationId: 'orch-ff',
        stepId: 'step-ff',
        workspaceId: 'ws-uuid-ff',
        outcome: 'timeout',
        decidedBy: 'system',
      }).catch((err: unknown) => { caught = err; });

      // Give the promise time to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('transient DB error');
    });
  });

  describe('listByOrchestration()', () => {
    it('calls db.select().from().where().orderBy() and returns rows', async () => {
      const fakeRows = [
        { id: 'row-1', orchestrationId: 'orch-list', stepId: 's1', workspaceId: 'ws-1',
          outcome: 'approved', decidedBy: 'u1', decidedAt: new Date(), reason: null, prompt: 'p1', createdAt: new Date() },
        { id: 'row-2', orchestrationId: 'orch-list', stepId: 's2', workspaceId: 'ws-1',
          outcome: 'timeout', decidedBy: 'system', decidedAt: new Date(), reason: null, prompt: null, createdAt: new Date() },
      ];
      mockOrderBy.mockImplementation(async () => fakeRows);

      const result = await gateAuditRepo.listByOrchestration('orch-list');

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockWhere).toHaveBeenCalledTimes(1);
      expect(mockOrderBy).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('row-1');
      expect(result[1]!.id).toBe('row-2');
    });

    it('returns empty array when no rows found', async () => {
      mockOrderBy.mockImplementation(async () => []);
      const result = await gateAuditRepo.listByOrchestration('orch-empty');
      expect(result).toHaveLength(0);
    });
  });
});

afterAll(() => mock.restore());
