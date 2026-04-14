import { describe, it, expect, mock, beforeEach } from 'bun:test';

// --- Mock ioredis shared client ---
const mockIncrbyfloat = mock((_key: string, _value: number) => Promise.resolve('0'));
const mockExpire = mock((_key: string, _ttl: number) => Promise.resolve(1));
const mockGet = mock((_key: string) => Promise.resolve(null as string | null));
const mockDel = mock((..._keys: string[]) => Promise.resolve(1));

// scan returns [cursor, [keys]] — simulate empty set by default
const mockScan = mock((_cursor: string, ..._args: any[]) =>
  Promise.resolve(['0', []] as [string, string[]]),
);

const mockPipelineExec = mock(() =>
  Promise.resolve([
    [null, '1.5'],   // incrbyfloat result
    [null, 1],       // expire result
  ]),
);

const mockPipeline = {
  incrbyfloat: mock((_key: string, _val: number) => mockPipeline),
  expire: mock((_key: string, _ttl: number) => mockPipeline),
  exec: mockPipelineExec,
};

const mockRedisClient = {
  incrbyfloat: mockIncrbyfloat,
  expire: mockExpire,
  get: mockGet,
  del: mockDel,
  scan: mockScan,
  pipeline: mock(() => mockPipeline),
};

const _realRedisClient = require('../../../infra/redis/client');
mock.module('../../../infra/redis/client', () => ({
  ..._realRedisClient,
  getSharedRedisClient: () => mockRedisClient,
}));

import {
  incrementBudgetCounter,
  getBudgetCounter,
  resetBudgetCounter,
  resetAllBudgetCountersForMonth,
} from '../budget-counter';

// Helper: current YYYY-MM
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

describe('budget-counter', () => {
  beforeEach(() => {
    mockPipeline.incrbyfloat.mockClear();
    mockPipeline.expire.mockClear();
    mockPipelineExec.mockClear();
    mockRedisClient.pipeline.mockClear();
    mockGet.mockClear();
    mockDel.mockClear();
    mockScan.mockClear();

    // Default exec returns [null, '1.5'] for incrbyfloat
    mockPipelineExec.mockImplementation(() =>
      Promise.resolve([
        [null, '1.5'],
        [null, 1],
      ]),
    );
    mockGet.mockImplementation(() => Promise.resolve(null));
    mockScan.mockImplementation(() => Promise.resolve(['0', []]));
  });

  describe('incrementBudgetCounter', () => {
    it('calls INCRBYFLOAT with the correct key and cost', async () => {
      const wsId = 'ws-abc';
      await incrementBudgetCounter(wsId, 0.0042);

      expect(mockPipeline.incrbyfloat).toHaveBeenCalledTimes(1);
      const [key, val] = (mockPipeline.incrbyfloat as any).mock.calls[0];
      expect(key).toBe(`budget:${wsId}:${currentMonth()}`);
      expect(val).toBe(0.0042);
    });

    it('sets EXPIRE on the key with a 35-day TTL', async () => {
      await incrementBudgetCounter('ws-ttl', 1);

      expect(mockPipeline.expire).toHaveBeenCalledTimes(1);
      const [, ttl] = (mockPipeline.expire as any).mock.calls[0];
      expect(ttl).toBe(35 * 24 * 60 * 60);
    });

    it('returns the new counter value from the pipeline result', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        [null, '7.125'],
        [null, 1],
      ]);
      const result = await incrementBudgetCounter('ws-ret', 2.5);
      expect(result).toBe(7.125);
    });

    it('returns 0 when pipeline result is unexpected', async () => {
      mockPipelineExec.mockResolvedValueOnce(null as any);
      const result = await incrementBudgetCounter('ws-null', 1);
      expect(result).toBe(0);
    });
  });

  describe('getBudgetCounter', () => {
    it('returns 0 when key does not exist', async () => {
      mockGet.mockResolvedValueOnce(null);
      const result = await getBudgetCounter('ws-new');
      expect(result).toBe(0);
    });

    it('returns parsed float when key exists', async () => {
      mockGet.mockResolvedValueOnce('3.14159');
      const result = await getBudgetCounter('ws-existing');
      expect(result).toBeCloseTo(3.14159);
    });

    it('calls GET with the correct key for the current month', async () => {
      mockGet.mockResolvedValueOnce('0');
      const wsId = 'ws-key-check';
      await getBudgetCounter(wsId);

      expect(mockGet).toHaveBeenCalledWith(`budget:${wsId}:${currentMonth()}`);
    });
  });

  describe('resetBudgetCounter', () => {
    it('calls DEL with the correct key for the specified month', async () => {
      await resetBudgetCounter('ws-reset', '2026-03');
      expect(mockDel).toHaveBeenCalledWith('budget:ws-reset:2026-03');
    });
  });

  describe('resetAllBudgetCountersForMonth', () => {
    it('returns 0 when no keys match', async () => {
      mockScan.mockResolvedValueOnce(['0', []]);
      const result = await resetAllBudgetCountersForMonth('2026-02');
      expect(result).toBe(0);
    });

    it('deletes matched keys and returns count', async () => {
      mockScan
        .mockResolvedValueOnce(['42', ['budget:ws-1:2026-02', 'budget:ws-2:2026-02']])
        .mockResolvedValueOnce(['0', ['budget:ws-3:2026-02']]);

      const result = await resetAllBudgetCountersForMonth('2026-02');
      expect(result).toBe(3);
      expect(mockDel).toHaveBeenCalledTimes(2);
    });

    it('uses SCAN with the correct MATCH pattern', async () => {
      mockScan.mockResolvedValueOnce(['0', []]);
      await resetAllBudgetCountersForMonth('2026-01');

      const [, , pattern] = (mockScan as any).mock.calls[0];
      expect(pattern).toBe('budget:*:2026-01');
    });
  });
});
