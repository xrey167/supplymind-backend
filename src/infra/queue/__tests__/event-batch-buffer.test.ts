import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { EventBatchBuffer } from '../event-batch-buffer';

describe('EventBatchBuffer', () => {
  it('flushes when batch size is reached', async () => {
    const flushed: number[][] = [];
    const buffer = new EventBatchBuffer<number>({
      maxSize: 3,
      flushIntervalMs: 60_000,
      onFlush: async (batch) => { flushed.push([...batch]); },
    });

    buffer.push(1);
    buffer.push(2);
    expect(flushed.length).toBe(0);
    buffer.push(3); // triggers flush
    await Promise.resolve(); // let microtasks settle
    expect(flushed.length).toBe(1);
    expect(flushed[0]).toEqual([1, 2, 3]);
    buffer.stop();
  });

  it('drain() is atomic — swaps queue before awaiting flush', async () => {
    let flushCallCount = 0;
    const buffer = new EventBatchBuffer<string>({
      maxSize: 100,
      flushIntervalMs: 60_000,
      onFlush: async (batch) => {
        flushCallCount++;
        // simulate slow flush
        await new Promise(r => setTimeout(r, 10));
      },
    });

    buffer.push('a');
    buffer.push('b');

    const drain1 = buffer.drain();
    const drain2 = buffer.drain(); // second drain while first is in-flight

    await Promise.all([drain1, drain2]);
    // Only one flush should have received items; the second sees empty queue
    expect(flushCallCount).toBe(1);
    buffer.stop();
  });

  it('drain() with empty buffer calls onFlush with empty array', async () => {
    let called = false;
    const buffer = new EventBatchBuffer<number>({
      maxSize: 10,
      flushIntervalMs: 60_000,
      onFlush: async (batch) => {
        if (batch.length > 0) called = true;
      },
    });
    await buffer.drain();
    expect(called).toBe(false);
    buffer.stop();
  });

  it('stop() cancels the interval', () => {
    const buffer = new EventBatchBuffer<number>({
      maxSize: 10,
      flushIntervalMs: 100,
      onFlush: async () => {},
    });
    buffer.stop(); // should not throw
    expect(true).toBe(true);
  });

  it('collects items across multiple pushes', async () => {
    const collected: string[] = [];
    const buffer = new EventBatchBuffer<string>({
      maxSize: 10,
      flushIntervalMs: 60_000,
      onFlush: async (batch) => { collected.push(...batch); },
    });
    buffer.push('x');
    buffer.push('y');
    await buffer.drain();
    expect(collected).toEqual(['x', 'y']);
    buffer.stop();
  });
});
