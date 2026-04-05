/**
 * FIFO-bounded set backed by a circular ring buffer.
 *
 * Evicts the oldest entry when capacity is reached, keeping memory usage
 * constant at O(capacity). Useful for message deduplication across any
 * transport (WS, SSE, A2A) without unbounded memory growth.
 *
 * Plug-and-play: instantiate with a capacity, add IDs, check membership.
 */
export class BoundedSet<T = string> {
  private readonly capacity: number;
  private readonly ring: (T | undefined)[];
  private readonly set = new Set<T>();
  private writeIdx = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.ring = new Array<T | undefined>(capacity);
  }

  /** Add an item. If at capacity, the oldest item is evicted. */
  add(item: T): void {
    if (this.set.has(item)) return;
    const evicted = this.ring[this.writeIdx];
    if (evicted !== undefined) {
      this.set.delete(evicted);
    }
    this.ring[this.writeIdx] = item;
    this.set.add(item);
    this.writeIdx = (this.writeIdx + 1) % this.capacity;
  }

  /** Check if an item exists in the set. */
  has(item: T): boolean {
    return this.set.has(item);
  }

  /** Remove all items. */
  clear(): void {
    this.set.clear();
    this.ring.fill(undefined);
    this.writeIdx = 0;
  }

  /** Current number of items in the set. */
  get size(): number {
    return this.set.size;
  }
}
