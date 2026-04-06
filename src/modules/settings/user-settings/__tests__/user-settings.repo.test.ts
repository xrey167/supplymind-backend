import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockSelect = mock(() => ({
  from: mock(() => ({
    where: mock(async () => [] as any[]),
  })),
}));
const mockInsert = mock(() => ({
  values: mock(async () => {}),
}));
const mockUpdate = mock(() => ({
  set: mock(() => ({
    where: mock(async () => {}),
  })),
}));
const mockDeleteFn = mock(() => ({
  where: mock(() => ({
    returning: mock(async () => []),
  })),
}));

mock.module('../../../../infra/db/client', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDeleteFn,
  },
}));

mock.module('../../../../infra/db/schema', () => ({
  userSettings: {
    userId: 'user_id',
    key: 'key',
    value: 'value',
    updatedAt: 'updated_at',
  },
}));

mock.module('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ col: a, val: b }),
  and: (...args: any[]) => args,
}));

import { UserSettingsRepository } from '../user-settings.repo';

describe('UserSettingsRepository', () => {
  let repo: UserSettingsRepository;

  beforeEach(() => {
    repo = new UserSettingsRepository();
    mockSelect.mockClear();
    mockInsert.mockClear();
    mockUpdate.mockClear();
    mockDeleteFn.mockClear();
  });

  describe('get', () => {
    test('should return value when setting exists', async () => {
      const whereMock = mock(async () => [{ userId: 'u1', key: 'theme', value: 'dark' }]);
      const fromMock = mock(() => ({ where: whereMock }));
      mockSelect.mockReturnValueOnce({ from: fromMock } as any);

      const result = await repo.get('u1', 'theme');

      expect(result).toBe('dark');
    });

    test('should return null when setting does not exist', async () => {
      const whereMock = mock(async () => []);
      const fromMock = mock(() => ({ where: whereMock }));
      mockSelect.mockReturnValueOnce({ from: fromMock } as any);

      const result = await repo.get('u1', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getAll', () => {
    test('should return key-value map', async () => {
      const whereMock = mock(async () => [
        { key: 'theme', value: 'dark' },
        { key: 'locale', value: 'en' },
      ]);
      const fromMock = mock(() => ({ where: whereMock }));
      mockSelect.mockReturnValueOnce({ from: fromMock } as any);

      const result = await repo.getAll('u1');

      expect(result).toEqual({ theme: 'dark', locale: 'en' });
    });

    test('should return empty object when no settings', async () => {
      const whereMock = mock(async () => []);
      const fromMock = mock(() => ({ where: whereMock }));
      mockSelect.mockReturnValueOnce({ from: fromMock } as any);

      const result = await repo.getAll('u1');

      expect(result).toEqual({});
    });
  });

  describe('delete', () => {
    test('should return true when row deleted', async () => {
      const returningMock = mock(async () => [{ id: '1' }]);
      const whereMock = mock(() => ({ returning: returningMock }));
      mockDeleteFn.mockReturnValueOnce({ where: whereMock } as any);

      const result = await repo.delete('u1', 'theme');

      expect(result).toBe(true);
    });

    test('should return false when no row to delete', async () => {
      const returningMock = mock(async () => []);
      const whereMock = mock(() => ({ returning: returningMock }));
      mockDeleteFn.mockReturnValueOnce({ where: whereMock } as any);

      const result = await repo.delete('u1', 'nonexistent');

      expect(result).toBe(false);
    });
  });
});
