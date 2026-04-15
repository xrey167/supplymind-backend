import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// DB mock — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockOnConflictDoNothing = mock(() => Promise.resolve());
const mockValues = mock((_rows: unknown[]) => ({ onConflictDoNothing: mockOnConflictDoNothing }));
const mockInsert = mock(() => ({ values: mockValues }));

const mockDeleteWhere = mock(() => Promise.resolve());
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

const _realDbClient = require('../../../infra/db/client');
mock.module('../../../infra/db/client', () => ({
  ..._realDbClient,
  db: {
    insert: mockInsert,
    delete: mockDelete,
  },
}));

// Schema mock — return plain objects for the table so eq/and can reference them
const _realDbSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({
  ..._realDbSchema,
  prompts: {
    workspaceId: 'prompts.workspaceId',
    pluginSource: 'prompts.pluginSource',
  },
}));

// drizzle-orm mock — eq/and just return their args for assertion purposes
const _realDrizzle = require('drizzle-orm');
mock.module('drizzle-orm', () => ({
  ..._realDrizzle,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...conds: unknown[]) => ({ conds }),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are in place
// ---------------------------------------------------------------------------

import { seedPluginPrompts, removePluginPrompts } from '../plugins.prompt-seeder';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedPluginPrompts', () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockValues.mockClear();
    mockOnConflictDoNothing.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  it('inserts prompt rows with pluginSource and prefixed name', async () => {
    await seedPluginPrompts('ws-1', 'supply-chain', [
      { name: 'low-stock-alert', content: 'Alert: {{sku}} is low on stock.', tags: ['alerts'] },
    ]);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledTimes(1);

    const rows = mockValues.mock.calls[0]?.[0] as any[];
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.pluginSource).toBe('supply-chain');
    expect(row.workspaceId).toBe('ws-1');
    expect(row.name).toBe('supply-chain/low-stock-alert');
    expect(row.isActive).toBe(true);
    expect(row.version).toBe(1);
    expect(row.tags).toEqual(['alerts']);
  });

  it('auto-extracts variables from content', async () => {
    await seedPluginPrompts('ws-1', 'my-plugin', [
      { name: 'reorder', content: 'Order {{sku}} from {{supplier}}. Count: {{sku}}.' },
    ]);

    const rows = mockValues.mock.calls[0]?.[0] as any[];
    const row = rows[0];
    // 'sku' should appear only once even though it appears twice in content
    expect(row.variables).toEqual([{ name: 'sku' }, { name: 'supplier' }]);
  });

  it('uses onConflictDoNothing — idempotent', async () => {
    await seedPluginPrompts('ws-1', 'plugin-x', [{ name: 'foo', content: 'bar' }]);
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('does nothing when templates array is empty', async () => {
    await seedPluginPrompts('ws-1', 'plugin-x', []);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('seeds multiple templates in a single insert', async () => {
    await seedPluginPrompts('ws-1', 'sc', [
      { name: 'tpl-a', content: 'Hello' },
      { name: 'tpl-b', content: 'World' },
      { name: 'tpl-c', content: 'Foo' },
    ]);

    const rows = mockValues.mock.calls[0]?.[0] as any[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['sc/tpl-a', 'sc/tpl-b', 'sc/tpl-c']);
  });
});

describe('removePluginPrompts', () => {
  beforeEach(() => {
    mockDelete.mockClear();
    mockDeleteWhere.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  it('calls delete with workspaceId and pluginSource condition', async () => {
    await removePluginPrompts('ws-1', 'supply-chain');

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
  });
});
