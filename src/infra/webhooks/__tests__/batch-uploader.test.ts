import { describe, it, expect } from 'bun:test';
import { BatchEventUploader } from '../batch-uploader';

describe('BatchEventUploader', () => {
  it('calls flush handler with batched events', async () => {
    const batches: unknown[][] = [];
    const uploader = new BatchEventUploader({
      maxBatchSize: 3,
      flushIntervalMs: 50,
      async flush(events) { batches.push([...events]); },
    });

    uploader.enqueue({ type: 'a' });
    uploader.enqueue({ type: 'b' });
    uploader.enqueue({ type: 'c' });

    await new Promise(r => setTimeout(r, 100));
    await uploader.drain();

    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.flat()).toHaveLength(3);
    uploader.stop();
  });

  it('respects maxBatchSize by splitting into multiple batches', async () => {
    const batches: unknown[][] = [];
    const uploader = new BatchEventUploader({
      maxBatchSize: 2,
      flushIntervalMs: 10,
      async flush(events) { batches.push([...events]); },
    });

    for (let i = 0; i < 5; i++) uploader.enqueue({ i });
    await new Promise(r => setTimeout(r, 100));
    await uploader.drain();

    const totalItems = batches.flat().length;
    expect(totalItems).toBe(5);
    expect(batches.every(b => b.length <= 2)).toBe(true);
    uploader.stop();
  });

  it('drain resolves immediately when queue is empty', async () => {
    const uploader = new BatchEventUploader({
      maxBatchSize: 10,
      flushIntervalMs: 1000,
      async flush() {},
    });

    await uploader.drain(); // should not hang
    uploader.stop();
  });
});
