import { describe, expect, mock, beforeEach, test } from 'bun:test';

const mockRedisGet = mock<() => Promise<string | null>>(async () => null);
const mockRedisSetex = mock(async () => 'OK');
const mockRedisDel = mock(async () => 1);

const mockDbWhere = mock(async () => []);
const mockDbFrom = mock(() => ({ where: mockDbWhere }));
const mockDbSelect = mock(() => ({ from: mockDbFrom }));

mock.module('../../../infra/redis/client', () => ({
  getSharedRedisClient: () => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
    del: mockRedisDel,
  }),
}));

mock.module('../../../infra/db/client', () => ({
  db: { select: mockDbSelect },
}));

const { workspacePolicyRepo } = await import('../workspace-policy.repo');

describe('workspacePolicyRepo.listForWorkspace', () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisSetex.mockReset();
    mockRedisDel.mockReset();
    mockDbSelect.mockReset();
    mockDbFrom.mockReset();
    mockDbWhere.mockReset();
    mockDbSelect.mockImplementation(() => ({ from: mockDbFrom }));
    mockDbFrom.mockImplementation(() => ({ where: mockDbWhere }));
    mockDbWhere.mockImplementation(async () => []);
  });

  test('normalizes cached date strings to Date objects', async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'pol-1',
          workspaceId: 'ws-1',
          name: 'Block legacy model',
          type: 'access',
          enabled: true,
          priority: 10,
          conditions: { model_pattern: 'legacy-*' },
          actions: { block: true },
          createdAt: '2026-04-17T08:00:00.000Z',
          updatedAt: '2026-04-17T08:30:00.000Z',
        },
      ]),
    );

    const result = await workspacePolicyRepo.listForWorkspace('ws-1');

    expect(result).toHaveLength(1);
    expect(result[0]?.createdAt).toBeInstanceOf(Date);
    expect(result[0]?.updatedAt).toBeInstanceOf(Date);
    expect(result[0]?.createdAt.toISOString()).toBe('2026-04-17T08:00:00.000Z');
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
