import { logger } from '../../config/logger';

export interface BatchUploaderConfig<T> {
  maxBatchSize?: number;
  flushIntervalMs?: number;
  flush(events: T[]): Promise<void>;
  maxConsecutiveFailures?: number;
}

/**
 * Ordered, batched event uploader with backpressure.
 *
 * Guarantees:
 *   - Events are flushed in enqueue order (serial — at most 1 in-flight flush)
 *   - Batches by count (maxBatchSize) and time interval (flushIntervalMs)
 *   - drain() blocks until queue is empty
 */
export class BatchEventUploader<T = unknown> {
  private queue: T[] = [];
  private flushing = false;
  private consecutiveFailures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private drainWaiters: Array<() => void> = [];

  private readonly maxBatchSize: number;
  private readonly maxConsecutiveFailures: number;
  private readonly flushFn: (events: T[]) => Promise<void>;

  constructor(config: BatchUploaderConfig<T>) {
    this.maxBatchSize = config.maxBatchSize ?? 100;
    this.maxConsecutiveFailures = config.maxConsecutiveFailures ?? 5;
    this.flushFn = config.flush;

    const interval = config.flushIntervalMs ?? 1000;
    this.timer = setInterval(() => this.tryFlush(), interval);
  }

  enqueue(event: T): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatchSize) this.tryFlush();
  }

  private async tryFlush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.maxBatchSize);
        try {
          await this.flushFn(batch);
          this.consecutiveFailures = 0;
        } catch (error) {
          this.consecutiveFailures++;
          logger.error({ error, batchSize: batch.length, consecutiveFailures: this.consecutiveFailures }, 'Batch flush failed');
          if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            logger.warn({ dropped: batch.length }, 'Dropping batch after max consecutive failures');
            this.consecutiveFailures = 0;
          } else {
            this.queue.unshift(...batch);
            break;
          }
        }
      }
    } finally {
      this.flushing = false;
      if (this.queue.length === 0) {
        this.drainWaiters.forEach(resolve => resolve());
        this.drainWaiters = [];
      }
    }
  }

  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.flushing) return;
    await this.tryFlush();
    if (this.queue.length > 0 || this.flushing) {
      await new Promise<void>(resolve => this.drainWaiters.push(resolve));
    }
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
