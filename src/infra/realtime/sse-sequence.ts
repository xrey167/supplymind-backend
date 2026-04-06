export interface SequencedEvent<T> {
  seq: number;
  event: T;
}

export interface SequencedEventBufferOptions {
  /** Maximum number of events to keep in memory for replay */
  maxBufferSize: number;
}

export class SequencedEventBuffer<T> {
  private seq = 0;
  private buffer: SequencedEvent<T>[] = [];
  private readonly maxSize: number;

  constructor(opts: SequencedEventBufferOptions) {
    this.maxSize = opts.maxBufferSize;
  }

  /** Append an event, assign it the next sequence number, return that number */
  push(event: T): number {
    this.seq++;
    this.buffer.push({ seq: this.seq, event });
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift(); // evict oldest
    }
    return this.seq;
  }

  /**
   * Return all buffered events with seq > fromSeq.
   * Reconnecting clients pass their last-seen seq to resume without gaps.
   */
  catchUp(fromSeq: number): SequencedEvent<T>[] {
    return this.buffer.filter(e => e.seq > fromSeq);
  }

  get currentSeq(): number {
    return this.seq;
  }
}
