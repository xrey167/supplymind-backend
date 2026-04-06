export interface EventBatchBufferOptions<T> {
  maxSize: number;
  flushIntervalMs: number;
  onFlush: (batch: T[]) => Promise<void>;
  /** Injectable clock for testing — defaults to setInterval/clearInterval */
  clock?: {
    setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
    clearInterval: (id: ReturnType<typeof setInterval>) => void;
  };
}

export class EventBatchBuffer<T> {
  private queue: T[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly opts: EventBatchBufferOptions<T>;

  constructor(opts: EventBatchBufferOptions<T>) {
    this.opts = opts;
    const clock = opts.clock ?? { setInterval, clearInterval };
    this.timer = clock.setInterval(() => {
      this.drain().catch(() => {/* errors surfaced via onFlush */});
    }, opts.flushIntervalMs);
  }

  push(item: T): void {
    this.queue.push(item);
    if (this.queue.length >= this.opts.maxSize) {
      this.drain().catch(() => {});
    }
  }

  /**
   * Atomically swaps the queue before awaiting flush.
   * Concurrent drain() calls will see an empty queue after the first swap.
   */
  async drain(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) return;
    await this.opts.onFlush(batch);
  }

  stop(): void {
    const clock = this.opts.clock ?? { setInterval, clearInterval };
    if (this.timer !== undefined) {
      clock.clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
