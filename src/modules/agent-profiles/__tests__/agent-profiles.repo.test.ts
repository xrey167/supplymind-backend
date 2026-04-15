import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

const mockReturning = mock(() => Promise.resolve([{
  id: 'ap-1',
  workspaceId: 'ws-1',
  name: 'Test Profile',
  category: 'executor',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  systemPrompt: null,
  temperature: 70,  // stored as int*100
  maxTokens: 4096,
  permissionMode: 'ask',
  isDefault: false,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}]));

const mockSelect = mock(() => ({ from: mockFrom }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockWhere = mock(() => Promise.resolve([{
  id: 'ap-1',
  workspaceId: 'ws-1',
  name: 'Test Profile',
  category: 'executor',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  systemPrompt: null,
  temperature: 70,
  maxTokens: 4096,
  permissionMode: 'ask',
  isDefault: false,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}]));

const mockInsert = mock(() => ({ values: mockValues }));
const mockValues = mock(() => ({ returning: mockReturning }));
const mockUpdate = mock(() => ({ set: mockSet }));
const mockSet = mock(() => ({ where: mockUpdateWhere }));
const mockUpdateWhere = mock(() => ({ returning: mockReturning }));
const mockDelete = mock(() => ({ where: mock(() => Promise.resolve()) }));

mock.module('../../../infra/db/client', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
}));

const _realSchema = require('../../../infra/db/schema');
mock.module('../../../infra/db/schema', () => ({
  ..._realSchema,
}));

const _realDrizzle = require('drizzle-orm');
mock.module('drizzle-orm', () => ({
  ..._realDrizzle,
  eq: mock((col: unknown, val: unknown) => ({ col, val })),
  and: mock((...args: unknown[]) => args),
}));

const { AgentProfilesRepository } = await import('../agent-profiles.repo');

describe('AgentProfilesRepository', () => {
  let repo: InstanceType<typeof AgentProfilesRepository>;

  beforeEach(() => {
    repo = new AgentProfilesRepository();
    mockReturning.mockClear();
    mockWhere.mockClear();
  });

  it('create() inserts profile and maps temperature from int*100 to float', async () => {
    const profile = await repo.create('ws-1', {
      name: 'Test Profile',
      category: 'executor',
      temperature: 0.7,
    });
    expect(profile.id).toBe('ap-1');
    // mapper converts int*100 → float
    expect(profile.temperature).toBeCloseTo(0.7);
  });

  it('findById() returns mapped profile or null', async () => {
    const profile = await repo.findById('ap-1');
    expect(profile?.id).toBe('ap-1');
    expect(profile?.category).toBe('executor');

    mockWhere.mockResolvedValueOnce([]);
    const missing = await repo.findById('nonexistent');
    expect(missing).toBeNull();
  });

  it('findByWorkspace() returns profiles list', async () => {
    const profiles = await repo.findByWorkspace('ws-1');
    expect(Array.isArray(profiles)).toBe(true);
  });

  it('update() returns null when row not found', async () => {
    mockReturning.mockResolvedValueOnce([]);
    const result = await repo.update('nonexistent', { name: 'New Name' });
    expect(result).toBeNull();
  });

  it('remove() calls delete', async () => {
    await repo.remove('ap-1');
    expect(mockDelete).toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
