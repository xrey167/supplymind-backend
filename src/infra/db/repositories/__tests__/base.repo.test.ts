/**
 * Unit tests for BaseRepo.
 *
 * Uses a lightweight mock of db that captures calls and returns configurable
 * results, without hitting a real database.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock the Drizzle db client before any imports that pull it in transitively
// ---------------------------------------------------------------------------

// Build a chainable query mock factory
function chainable(terminal: () => Promise<any>): Record<string, any> {
  const chain: Record<string, any> = {};
  const methods = ['select', 'insert', 'update', 'delete', 'from', 'where', 'set', 'values', 'limit', 'returning'];
  for (const m of methods) {
    chain[m] = mock(() => chain);
  }
  // The last call in the chain resolves the promise
  chain['_resolve'] = terminal;
  // Expose then/catch so await works on the chain itself
  chain.then = (resolve: any, reject: any) => terminal().then(resolve, reject);
  return chain;
}

// Shared return store — tests push values into this to control query results
const returnQueue: any[][] = [];
function nextReturn(): any[] {
  return returnQueue.shift() ?? [];
}

const mockDb = {
  select: mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        limit: mock(() => ({ then: (_r: any) => Promise.resolve(nextReturn()).then(_r) })),
        then: (_r: any) => Promise.resolve(nextReturn()).then(_r),
      })),
      then: (_r: any) => Promise.resolve(nextReturn()).then(_r),
    })),
  })),
  insert: mock(() => ({
    values: mock(() => ({
      returning: mock(() => ({ then: (_r: any) => Promise.resolve(nextReturn()).then(_r) })),
    })),
  })),
  update: mock(() => ({
    set: mock(() => ({
      where: mock(() => ({
        returning: mock(() => ({ then: (_r: any) => Promise.resolve(nextReturn()).then(_r) })),
      })),
    })),
  })),
  delete: mock(() => ({
    where: mock(() => ({
      returning: mock(() => ({ then: (_r: any) => Promise.resolve(nextReturn()).then(_r) })),
    })),
  })),
};

const _realDb = require('../../client');
mock.module('../../client', () => ({
  ..._realDb,
  db: mockDb,
}));

// Mock drizzle-orm eq to be a simple identity-preserving stub
const _realDrizzle = require('drizzle-orm');
mock.module('drizzle-orm', () => ({
  ..._realDrizzle,
  eq: (col: any, val: any) => ({ col, val, _type: 'eq' }),
  and: (...args: any[]) => ({ args, _type: 'and' }),
  isNull: (col: any) => ({ col, _type: 'isNull' }),
}));

// ---------------------------------------------------------------------------
// Create a minimal fake table that satisfies the BaseRepo constraint
// ---------------------------------------------------------------------------

const fakeTable = {
  id: Symbol('id_column'),
  name: Symbol('name_column'),
  updatedAt: Symbol('updatedAt_column'),
};

// ---------------------------------------------------------------------------
// Import and instantiate a concrete BaseRepo subclass
// ---------------------------------------------------------------------------

const { BaseRepo } = await import('../base.repo');

// Concrete subclass using `any` to sidestep complex generic inference in test context
class TestRepo extends (BaseRepo as any) {
  constructor() {
    super(fakeTable);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseRepo', () => {
  let repo: TestRepo;

  beforeEach(() => {
    returnQueue.length = 0;
    repo = new TestRepo();
  });

  // -- findById -------------------------------------------------------------

  test('findById returns the first row when found', async () => {
    const expected: FakeRow = { id: 'row-1', name: 'Alpha' };
    returnQueue.push([expected]);
    const result = await repo.findById('row-1');
    expect(result).toEqual(expected);
  });

  test('findById returns null when no rows returned', async () => {
    returnQueue.push([]);
    const result = await repo.findById('missing');
    expect(result).toBeNull();
  });

  // -- findAll --------------------------------------------------------------

  test('findAll returns all rows when no filters', async () => {
    const rows: FakeRow[] = [
      { id: 'r1', name: 'A' },
      { id: 'r2', name: 'B' },
    ];
    returnQueue.push(rows);
    const result = await repo.findAll();
    expect(result).toEqual(rows);
  });

  test('findAll with filters applies where clause', async () => {
    returnQueue.push([{ id: 'r1', name: 'A' }]);
    const result = await repo.findAll({ name: 'A' } as any);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('A');
  });

  // -- create ---------------------------------------------------------------

  test('create inserts data and returns the inserted row', async () => {
    const inserted: FakeRow = { id: 'new-1', name: 'New Item' };
    returnQueue.push([inserted]);
    const result = await repo.create({ name: 'New Item' });
    expect(result).toEqual(inserted);
  });

  // -- update ---------------------------------------------------------------

  test('update returns the updated row when found', async () => {
    const updated: FakeRow = { id: 'u-1', name: 'Updated', updatedAt: new Date() };
    returnQueue.push([updated]);
    const result = await repo.update('u-1', { name: 'Updated' });
    expect(result).toEqual(updated);
  });

  test('update returns null when row does not exist', async () => {
    returnQueue.push([]);
    const result = await repo.update('missing', { name: 'x' });
    expect(result).toBeNull();
  });

  // -- remove ---------------------------------------------------------------

  test('remove returns true when a row was deleted', async () => {
    returnQueue.push([{ id: 'del-1' }]);
    const result = await repo.remove('del-1');
    expect(result).toBe(true);
  });

  test('remove returns false when row does not exist', async () => {
    returnQueue.push([]);
    const result = await repo.remove('ghost');
    expect(result).toBe(false);
  });
});
