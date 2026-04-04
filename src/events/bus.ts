import { nanoid } from 'nanoid';

export interface BusEvent {
  id: string;
  topic: string;
  data: unknown;
  source: string;
  timestamp: string;
  correlationId?: string;
  meta?: Record<string, unknown>;
}

export interface Subscription {
  id: string;
  pattern: string;
  handler: (event: BusEvent) => void | Promise<void>;
  filter?: Record<string, unknown>;
  name?: string;
  createdAt: number;
  matchCount: number;
  lastMatchedAt?: number;
  consecutiveFailures: number;
}

export interface DeadLetter {
  event: BusEvent;
  subscriptionId: string;
  error: string;
  timestamp: number;
}

const MAX_HISTORY = 1000;
const MAX_DEAD_LETTERS = 200;
const HISTORY_TTL_MS = 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 5;

export class EventBus {
  private subscriptions = new Map<string, Subscription>();
  private history: BusEvent[] = [];
  private deadLetters: DeadLetter[] = [];
  private groups = new Map<string, Set<string>>();

  async publish(
    topic: string,
    data: unknown,
    opts?: { source?: string; correlationId?: string; meta?: Record<string, unknown> },
  ): Promise<BusEvent> {
    const event: BusEvent = {
      id: nanoid(),
      topic,
      data,
      source: opts?.source ?? 'system',
      timestamp: new Date().toISOString(),
      correlationId: opts?.correlationId,
      meta: opts?.meta,
    };

    this.history.push(event);
    this.pruneHistory();

    const deliveries: Promise<void>[] = [];
    for (const sub of this.subscriptions.values()) {
      if (!topicMatches(sub.pattern, topic)) continue;
      if (sub.filter && !matchesFilter(event, sub.filter)) continue;

      sub.matchCount++;
      sub.lastMatchedAt = Date.now();
      deliveries.push(this.deliver(sub, event));
    }
    await Promise.allSettled(deliveries);
    return event;
  }

  subscribe(
    pattern: string,
    handler: (event: BusEvent) => void | Promise<void>,
    opts?: { filter?: Record<string, unknown>; name?: string },
  ): string {
    const sub: Subscription = {
      id: nanoid(),
      pattern,
      handler,
      filter: opts?.filter,
      name: opts?.name,
      createdAt: Date.now(),
      matchCount: 0,
      consecutiveFailures: 0,
    };
    this.subscriptions.set(sub.id, sub);
    return sub.id;
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  subscribeWithGroup(
    group: string,
    pattern: string,
    handler: (event: BusEvent) => void | Promise<void>,
    opts?: { filter?: Record<string, unknown>; name?: string },
  ): string {
    const id = this.subscribe(pattern, handler, { ...opts, name: opts?.name ?? group });
    if (!this.groups.has(group)) this.groups.set(group, new Set());
    this.groups.get(group)!.add(id);
    return id;
  }

  unsubscribeGroup(group: string): number {
    const ids = this.groups.get(group);
    if (!ids) return 0;
    let removed = 0;
    for (const id of ids) {
      if (this.unsubscribe(id)) removed++;
    }
    this.groups.delete(group);
    return removed;
  }

  replay(pattern: string, sinceIso?: string, limit?: number): BusEvent[] {
    const since = sinceIso ? new Date(sinceIso).getTime() : 0;
    const matching = this.history.filter(
      (e) => topicMatches(pattern, e.topic) && new Date(e.timestamp).getTime() >= since,
    );
    return limit ? matching.slice(-limit) : matching;
  }

  getHistory(): BusEvent[] {
    return [...this.history];
  }

  getDeadLetters(limit = 50): DeadLetter[] {
    return this.deadLetters.slice(-limit);
  }

  getStats(): { subscriptions: number; historySize: number; deadLetterCount: number } {
    return {
      subscriptions: this.subscriptions.size,
      historySize: this.history.length,
      deadLetterCount: this.deadLetters.length,
    };
  }

  reset(): void {
    this.subscriptions.clear();
    this.history.length = 0;
    this.deadLetters.length = 0;
    this.groups.clear();
  }

  private async deliver(sub: Subscription, event: BusEvent): Promise<void> {
    try {
      await sub.handler(event);
      sub.consecutiveFailures = 0;
    } catch (err) {
      sub.consecutiveFailures++;
      this.deadLetters.push({
        event,
        subscriptionId: sub.id,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      if (this.deadLetters.length > MAX_DEAD_LETTERS) {
        this.deadLetters.splice(0, this.deadLetters.length - MAX_DEAD_LETTERS);
      }
      if (sub.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `[EventBus] Auto-unsubscribing "${sub.name ?? sub.id}" after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
        );
        this.subscriptions.delete(sub.id);
      }
    }
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - HISTORY_TTL_MS;
    let removeCount = 0;
    for (let i = 0; i < this.history.length; i++) {
      if (new Date(this.history[i].timestamp).getTime() < cutoff) removeCount = i + 1;
      else break;
    }
    const overCapacity = this.history.length - removeCount - MAX_HISTORY;
    if (overCapacity > 0) removeCount += overCapacity;
    if (removeCount > 0) this.history.splice(0, removeCount);
  }
}

export function topicMatches(pattern: string, topic: string): boolean {
  const pp = pattern.split('.');
  const tp = topic.split('.');

  function match(pi: number, ti: number): boolean {
    if (pi === pp.length && ti === tp.length) return true;
    if (pi === pp.length) return false;
    if (pp[pi] === '#') {
      for (let i = ti; i <= tp.length; i++) {
        if (match(pi + 1, i)) return true;
      }
      return false;
    }
    if (ti === tp.length) return false;
    if (pp[pi] === '*' || pp[pi] === tp[ti]) return match(pi + 1, ti + 1);
    return false;
  }
  return match(0, 0);
}

function matchesFilter(event: BusEvent, filter: Record<string, unknown>): boolean {
  for (const [path, expected] of Object.entries(filter)) {
    if (getNestedValue(event, path) !== expected) return false;
  }
  return true;
}

function getNestedValue(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export const eventBus = new EventBus();
