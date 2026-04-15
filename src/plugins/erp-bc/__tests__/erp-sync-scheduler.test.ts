import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// --------------------------------------------------------------------------
// Mock BullMQ Queue
// --------------------------------------------------------------------------

const mockUpsertJobScheduler = mock(() => Promise.resolve());
const mockRemoveJobScheduler = mock(() => Promise.resolve());

const _realBullmq = require('bullmq');
mock.module('bullmq', () => ({
  ..._realBullmq,
  Queue: class MockQueue {
    upsertJobScheduler(...args: unknown[]) {
      return mockUpsertJobScheduler(...args);
    }
    removeJobScheduler(...args: unknown[]) {
      return mockRemoveJobScheduler(...args);
    }
  },
}));

// --------------------------------------------------------------------------
// Mock the BullMQ redis connection export so the Queue constructor does not
// try to open a real socket during tests.
// --------------------------------------------------------------------------

const _realInfraBullmq = require('../../../infra/queue/bullmq');
mock.module('../../../infra/queue/bullmq', () => ({
  ..._realInfraBullmq,
  redis: { /* stub — never used in tests */ },
}));

// --------------------------------------------------------------------------
// Mock syncJobsRepo
// --------------------------------------------------------------------------

const mockListScheduled = mock(() =>
  Promise.resolve([
    { id: 'job-1', schedule: '*/5 * * * *', status: 'idle' },
    { id: 'job-2', schedule: '0 * * * *', status: 'idle' },
  ]),
);

const _realSyncJobsRepo = require('../sync/sync-jobs.repo');
mock.module('../sync/sync-jobs.repo', () => ({
  ..._realSyncJobsRepo,
  syncJobsRepo: {
    listScheduled: mockListScheduled,
  },
}));

// --------------------------------------------------------------------------
// Mock logger — we want to spy on warn/error without console noise
// --------------------------------------------------------------------------

const mockLoggerError = mock(() => {});
const mockLoggerWarn = mock(() => {});
const mockLoggerInfo = mock(() => {});

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

// --------------------------------------------------------------------------
// Now import the module under test (after all mocks are set up)
// --------------------------------------------------------------------------

// Force a fresh module load so prior test files' caches don't contaminate this one.
const _syncSchedulerMod = await import('../sync/erp-sync-scheduler?fresh=1' as unknown as string);
const { bootstrapErpSyncSchedules, upsertSyncSchedule, removeSyncSchedule } = _syncSchedulerMod;

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('erp-sync-scheduler', () => {
  beforeEach(() => {
    mockUpsertJobScheduler.mockClear();
    mockRemoveJobScheduler.mockClear();
    mockListScheduled.mockClear();
    mockLoggerError.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerInfo.mockClear();
  });

  // -------------------------------------------------------------------------
  // bootstrapErpSyncSchedules
  // -------------------------------------------------------------------------

  describe('bootstrapErpSyncSchedules', () => {
    it('calls upsertJobScheduler once for each scheduled job', async () => {
      await bootstrapErpSyncSchedules();

      expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(2);
    });

    it('passes the correct scheduler key and cron pattern for job-1', async () => {
      await bootstrapErpSyncSchedules();

      const calls = mockUpsertJobScheduler.mock.calls;
      const call1 = calls.find((c) => c[0] === 'erp-sync-cron:job-1');
      expect(call1).toBeDefined();
      expect(call1![1]).toEqual({ pattern: '*/5 * * * *' });
      expect(call1![2]).toMatchObject({ name: 'erp-sync', data: { jobId: 'job-1' } });
    });

    it('passes the correct scheduler key and cron pattern for job-2', async () => {
      await bootstrapErpSyncSchedules();

      const calls = mockUpsertJobScheduler.mock.calls;
      const call2 = calls.find((c) => c[0] === 'erp-sync-cron:job-2');
      expect(call2).toBeDefined();
      expect(call2![1]).toEqual({ pattern: '0 * * * *' });
      expect(call2![2]).toMatchObject({ name: 'erp-sync', data: { jobId: 'job-2' } });
    });

    it('logs an error but does NOT throw when upsertJobScheduler rejects (invalid cron)', async () => {
      mockListScheduled.mockImplementationOnce(() =>
        Promise.resolve([{ id: 'bad-job', schedule: 'NOT_A_CRON', status: 'idle' }]),
      );
      mockUpsertJobScheduler.mockImplementationOnce(() =>
        Promise.reject(new Error('Invalid cron expression')),
      );

      await expect(bootstrapErpSyncSchedules()).resolves.toBeUndefined();
      expect(mockLoggerError).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // upsertSyncSchedule
  // -------------------------------------------------------------------------

  describe('upsertSyncSchedule', () => {
    it('calls upsertJobScheduler with key erp-sync-cron:<id> and the given cron pattern', async () => {
      await upsertSyncSchedule('test-id', '*/5 * * * *');

      expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        'erp-sync-cron:test-id',
        { pattern: '*/5 * * * *' },
        { name: 'erp-sync', data: { jobId: 'test-id' } },
      );
    });
  });

  // -------------------------------------------------------------------------
  // removeSyncSchedule
  // -------------------------------------------------------------------------

  describe('removeSyncSchedule', () => {
    it('calls removeJobScheduler with key erp-sync-cron:<id>', async () => {
      await removeSyncSchedule('test-id');

      expect(mockRemoveJobScheduler).toHaveBeenCalledTimes(1);
      expect(mockRemoveJobScheduler).toHaveBeenCalledWith('erp-sync-cron:test-id');
    });
  });
});

afterAll(() => mock.restore());
