import { describe, test, expect, mock } from 'bun:test';

// Stub BullMQ Worker so no real Redis connection is needed
const mockWorkerClose = mock(() => Promise.resolve());
const mockWorkerOn = mock(() => {});
const MockWorker = mock(() => ({ close: mockWorkerClose, on: mockWorkerOn }));

const _realBullmq = require('bullmq');
mock.module('bullmq', () => ({ ..._realBullmq, Worker: MockWorker }));

import { erpBcManifest } from '../manifest';

describe('erpBcManifest contributions', () => {
  test('manifest has contributions block', () => {
    expect(erpBcManifest.contributions).toBeDefined();
  });

  describe('workers contribution', () => {
    test('declares exactly one worker', () => {
      const workers = erpBcManifest.contributions?.workers ?? [];
      expect(workers).toHaveLength(1);
    });

    test('worker has correct name and queueName', () => {
      const worker = erpBcManifest.contributions?.workers?.[0];
      expect(worker?.name).toBe('erp-bc:sync');
      expect(worker?.queueName).toBe('erp-sync');
    });

    test('factory is a function', () => {
      const worker = erpBcManifest.contributions?.workers?.[0];
      expect(typeof worker?.factory).toBe('function');
    });

    test('factory returns a worker when called with a redis connection', () => {
      const worker = erpBcManifest.contributions?.workers?.[0];
      const result = worker?.factory({} as any);
      expect(result).toBeDefined();
      expect(typeof result?.close).toBe('function');
    });
  });
});
