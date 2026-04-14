import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Stub out drizzle-orm so BaseRepo can be loaded without a real DB connection.
// We mock the db module before importing BaseRepo.
// ---------------------------------------------------------------------------

// Build mock DB builder chains.
// Each terminal method resolves with `mockRows` which tests override per-case.
let mockRows: unknown[] = [];

const makeReturning = () => mock(() => Promise.resolve(mockRows));
const makeLimit = () => mock(() => Promise.resolve(mockRows));

let mockReturning = makeReturning();
let mockLimit = makeLimit();

const mockWhere = mock(() => ({
  returning: mockReturning,
  limit: mockLimit,
}));
const mockSet = mock(() => ({ where: mockWhere }));
const mockValues = mock(() => ({ returning: mockReturning }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));
const mockInsert = mock(() => ({ values: mockValues }));
const mockUpdate = mock(() => ({ set: mockSet }));
const mockDelete = mock(() => ({ where: mockWhere }));

// Mock db/client — no real DB needed for unit tests
mock.module('../../client', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
  closeDb: async () => {},
}));

// Stub eq so it doesn't need a real Drizzle column object
mock.module('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, type: 'eq' }),
}));

// ---------------------------------------------------------------------------
// Concrete test subclass
// ---------------------------------------------------------------------------
const { BaseRepo } = await import('../base.repo');

type TestSelect = { id: string; name: string };
type TestInsert = { name: string };

// Minimal fake table shape — BaseRepo only accesses `.id` on the table object
const fakeTable = { id: 'id_column', _: { name: 'test_table' } } as any;

class TestRepo extends BaseRepo<typeof fakeTable, TestSelect, TestInsert> {
  constructor() {
    super(fakeTable);
  }
}

// ---------------------------------------------------------------------------
// Helper: reset all chain mocks and set up default implementations
// ---------------------------------------------------------------------------
function resetMocks(rows: unknown[] = []) {
  mockRows = rows;

  mockReturning = makeReturning();
  mockLimit = makeLimit();

  mockWhere.mockReset();
  mockWhere.mockImplementation(() => ({
    returning: mockReturning,
    limit: mockLimit,
  }));

  mockSet.mockReset();
  mockSet.mockImplementation(() => ({ where: mockWhere }));

  mockValues.mockReset();
  mockValues.mockImplementation(() => ({ returning: mockReturning }));

  mockFrom.mockReset();
  mockFrom.mockImplementation(() => ({ where: mockWhere }));

  mockSelect.mockReset();
  mockSelect.mockImplementation(() => ({ from: mockFrom }));

  mockInsert.mockReset();
  mockInsert.mockImplementation(() => ({ values: mockValues }));

  mockUpdate.mockReset();
  mockUpdate.mockImplementation(() => ({ set: mockSet }));

  mockDelete.mockReset();
  mockDelete.mockImplementation(() => ({ where: mockWhere }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BaseRepo', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = new TestRepo();
  });

  describe('findById', () => {
    it('returns the row when found', async () => {
      const row = { id: 'abc', name: 'Test' };
      resetMocks([row]);
      mockLimit.mockImplementation(() => Promise.resolve([row]));
      mockWhere.mockImplementation(() => ({ limit: mockLimit }));

      const result = await repo.findById('abc');
      expect(result).toEqual(row);
    });

    it('returns null when no rows are returned', async () => {
      resetMocks([]);
      mockLimit.mockImplementation(() => Promise.resolve([]));
      mockWhere.mockImplementation(() => ({ limit: mockLimit }));

      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns all rows from the table', async () => {
      const allRows = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
      resetMocks(allRows);
      mockFrom.mockImplementation(() => Promise.resolve(allRows));
      mockSelect.mockImplementation(() => ({ from: mockFrom }));

      const result = await repo.findAll();
      expect(result).toEqual(allRows);
    });

    it('returns empty array when table is empty', async () => {
      resetMocks([]);
      mockFrom.mockImplementation(() => Promise.resolve([]));
      mockSelect.mockImplementation(() => ({ from: mockFrom }));

      const result = await repo.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('inserts and returns the created row', async () => {
      const created = { id: 'new-1', name: 'New' };
      resetMocks([created]);
      mockReturning.mockImplementation(() => Promise.resolve([created]));
      mockValues.mockImplementation(() => ({ returning: mockReturning }));
      mockInsert.mockImplementation(() => ({ values: mockValues }));

      const result = await repo.create({ name: 'New' });
      expect(result).toEqual(created);
    });
  });

  describe('update', () => {
    it('updates and returns the updated row', async () => {
      const updated = { id: 'upd-1', name: 'Updated' };
      resetMocks([updated]);
      mockReturning.mockImplementation(() => Promise.resolve([updated]));
      mockWhere.mockImplementation(() => ({ returning: mockReturning }));
      mockSet.mockImplementation(() => ({ where: mockWhere }));
      mockUpdate.mockImplementation(() => ({ set: mockSet }));

      const result = await repo.update('upd-1', { name: 'Updated' });
      expect(result).toEqual(updated);
    });

    it('returns null when the record is not found', async () => {
      resetMocks([]);
      mockReturning.mockImplementation(() => Promise.resolve([]));
      mockWhere.mockImplementation(() => ({ returning: mockReturning }));
      mockSet.mockImplementation(() => ({ where: mockWhere }));
      mockUpdate.mockImplementation(() => ({ set: mockSet }));

      const result = await repo.update('ghost', { name: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('returns true when a row was deleted', async () => {
      resetMocks([{ id: 'del-1' }]);
      mockReturning.mockImplementation(() => Promise.resolve([{ id: 'del-1' }]));
      mockWhere.mockImplementation(() => ({ returning: mockReturning }));
      mockDelete.mockImplementation(() => ({ where: mockWhere }));

      const result = await repo.remove('del-1');
      expect(result).toBe(true);
    });

    it('returns false when no row was deleted', async () => {
      resetMocks([]);
      mockReturning.mockImplementation(() => Promise.resolve([]));
      mockWhere.mockImplementation(() => ({ returning: mockReturning }));
      mockDelete.mockImplementation(() => ({ where: mockWhere }));

      const result = await repo.remove('ghost');
      expect(result).toBe(false);
    });
  });
});
