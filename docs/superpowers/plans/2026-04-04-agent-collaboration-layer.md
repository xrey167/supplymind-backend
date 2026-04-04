# Agent Collaboration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the general agent collaboration infrastructure — event bus with wildcards & history, Redis pub/sub for A2C, agent collaboration protocols (fan-out/consensus/debate/map-reduce), workflow engine with DAG orchestration, and skill composer for declarative pipelines.

**Architecture:** Replace the basic EventEmitter3 bus with a topic-based pub/sub system supporting wildcard matching, event history, dead letter queues, and replay. Layer Redis pub/sub on top for cross-service A2C communication. Build agent collaboration as structured multi-agent patterns dispatched through the skill registry. Workflow engine executes DAG-ordered steps with template substitution (with security sanitization) between them. All protocols (A2A, A2C, A2UI, MCP) flow through the unified event system.

**Tech Stack:** Bun runtime, ioredis (already installed), Hono + @hono/zod-openapi (Zod v4 validation), bun:test. No new dependencies needed.

---

## Review Notes & Fixes Applied

### Approach: General base first, domain-specific later
All supply-chain-specific features (domain events, alert intelligence, entity health, ERP cache) are deferred. This plan builds the general collaboration infrastructure that any domain can use.

### Fixes from plan review:
1. **Task 2**: `bridgeFromRedis` now logs parse errors to event bus instead of silent `catch {}`
2. **Task 3**: Supply chain role injection deferred — added TODO placeholder for domain-specific roles
3. **Task 4**: Added `when` conditional evaluation, exponential backoff for retries, template sanitization (shell injection prevention, prompt injection XML wrapping, null byte/control char stripping, prototype pollution guard)
4. **Task 5**: Pipeline persistence (Drizzle) deferred — old codebase had versioned SQLite storage
5. **Task 6**: Routes now use `@hono/zod-openapi` with Zod v4 schemas. Removed `ERROR: 'error.#'` wildcard from Topics. Domain/supply-chain topics marked as TODO
6. **Task 7**: Integration test covers new features

### Gaps identified (NOT in this plan — separate plans needed):
These are features from the old codebase that are completely missing from SupplyMindAI. Each warrants its own implementation plan. Grouped by: **General Base** (build next) vs **Domain-Specific** (deferred).

#### General Base — Build Next
| Gap | Old Codebase File | Priority | Description |
|-----|-------------------|----------|-------------|
| **Action Pipeline & Queue** | `action-pipeline.ts`, `action-queue.ts` | HIGH | Pre/post hooks, approval workflows, idempotency, priority ordering, connector dispatch, batch execution |
| **Audit Trail** | `audit.ts` | HIGH | Immutable log, query with filters, stats (success rate, top skills/actors), retention pruning |
| **Circuit Breaker** | `circuit-breaker.ts` | HIGH | 3-state (closed/open/half-open), configurable thresholds, metrics — needed for external service resilience |
| **Webhook Ingestion** | `webhooks.ts` | HIGH | Inbound HMAC-SHA256 verification, field mappings, delivery dedup, async execution |
| **Notification Channels** | `notifications.ts` | MEDIUM | Multi-channel dispatch (Slack, Telegram, Email, WhatsApp, Teams, SMS) — general infra |
| **Notification Preferences** | `notifications/preferences.ts` | MEDIUM | Per-user: channels, min severity, quiet hours, topic globs, muted topics |
| **Collaborative Intelligence** | `collaborative-intelligence.ts` | MEDIUM | Investigation boards, @mentions, voting, multi-level approval chains, activity feed (8 DB tables) |
| **Alert Rules Engine** | `alert-rules.ts` | MEDIUM | Persistent rules with conditions, cooldowns, message templating — general alerting layer |

#### Domain-Specific — Deferred (TODO)
| Gap | Old Codebase File | Priority | Description |
|-----|-------------------|----------|-------------|
| **Alert Intelligence Pipeline** | `alert-intelligence.ts` | TODO | Smart routing: dedup, dismissal learning, quiet hours, daily budget, score threshold, digest queue |
| **Alert Engine / Predictive Monitoring** | `alert-engine.ts` | TODO | Registered checks (high risk, stale entity, ERP sync), incident aggregation, playbook triggers |
| **Alert Correlation** | `alert-correlation.ts` | TODO | Geographic, supply chain, temporal clustering + impact assessment with cascading effects |
| **Entity Health Scoring** | `entity-health.ts` | TODO | Composite 4-dimension score: risk, data quality, action success, annotations |
| **ERP Cache** | `erp-cache.ts` | TODO | Type-specific TTLs, stale detection, freshness reports — relevant when ERP integration is built |
| **Domain Events Strategies** | `domain-events.ts` | TODO | Skeleton created in `src/events/domain/` — threshold logic not yet implemented |

### Multi-provider considerations (already correct):
The collaboration engine, workflow engine, and skill composer are all provider-agnostic by design. They dispatch through `DispatchFn` → skill registry → agent runtime. Each agent independently configures its provider (anthropic/openai/google) and mode (raw/agent-sdk). No changes needed for multi-provider support.

---

## File Structure

```
src/
  events/
    bus.ts                        (REWRITE) Full event bus: wildcard topics, history, dead letters, replay, subscriber groups
    topics.ts                     (MODIFY)  Add collaboration + workflow event topics
    publishers/index.ts           (MODIFY)  Add typed publish helpers for new topics

  infra/
    redis/
      client.ts                   (EXISTS)  Redis singleton — no changes
      pubsub.ts                   (CREATE)  Redis pub/sub adapter: publish to Redis channels, subscribe from Redis

    realtime/
      ws-server.ts                (MODIFY)  Wire to new event bus, add entity/type filtering
      ws-types.ts                 (MODIFY)  Add collaboration message types
      sse-stream.ts               (MODIFY)  Wire to new event bus

  modules/
    collaboration/
      collaboration.types.ts      (CREATE)  CollaborationStrategy, CollaborationRequest, CollaborationResult, AgentResponse
      collaboration.engine.ts     (CREATE)  collaborate() dispatcher: fan-out, consensus, debate, map-reduce
      collaboration.routes.ts     (CREATE)  POST /collaborate endpoint
      index.ts                    (CREATE)  Barrel export

    workflows/
      workflows.types.ts          (CREATE)  WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult
      workflows.engine.ts         (CREATE)  executeWorkflow() — DAG scheduler with template substitution
      workflows.templates.ts      (CREATE)  resolveTemplate() — {{stepId.result}}, {{input.*}} resolution
      workflows.routes.ts         (CREATE)  POST /workflows/run endpoint
      index.ts                    (CREATE)  Barrel export

    skills/
      skills.composer.ts          (CREATE)  compose() + executePipeline() — declarative skill chaining
      skills.composer.types.ts    (CREATE)  Pipeline, PipelineStep, PipelineResult types

  api/routes/
    workspace/index.ts            (MODIFY)  Mount collaboration + workflows routes
```

---

### Task 1: Event Bus — Core with Wildcard Topics

**Files:**
- Rewrite: `src/events/bus.ts`
- Test: `src/events/__tests__/bus.test.ts`

This is the foundation. Everything else depends on it. The new bus must support wildcard topic matching (`*` = one segment, `#` = zero or more segments), event history with TTL, dead letter queue, replay, and subscriber groups.

- [ ] **Step 1: Write failing tests for topic matching**

```typescript
// src/events/__tests__/bus.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { EventBus } from '../bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('topic matching', () => {
    test('exact match', async () => {
      const received: unknown[] = [];
      bus.subscribe('agent.shell.completed', (e) => { received.push(e.data); });
      await bus.publish('agent.shell.completed', { ok: true });
      expect(received).toEqual([{ ok: true }]);
    });

    test('* matches one segment', async () => {
      const received: unknown[] = [];
      bus.subscribe('agent.*.completed', (e) => { received.push(e.data); });
      await bus.publish('agent.shell.completed', { tool: 'shell' });
      await bus.publish('agent.ai.completed', { tool: 'ai' });
      await bus.publish('agent.shell.failed', { tool: 'shell' }); // should NOT match
      expect(received).toEqual([{ tool: 'shell' }, { tool: 'ai' }]);
    });

    test('# matches zero or more segments', async () => {
      const received: string[] = [];
      bus.subscribe('workflow.#', (e) => { received.push(e.topic); });
      await bus.publish('workflow', 'a');
      await bus.publish('workflow.step.1.done', 'b');
      await bus.publish('workflow.completed', 'c');
      expect(received).toEqual(['workflow', 'workflow.step.1.done', 'workflow.completed']);
    });

    test('no match for unrelated topic', async () => {
      const received: unknown[] = [];
      bus.subscribe('agent.*', (e) => { received.push(e); });
      await bus.publish('workflow.started', {});
      expect(received).toHaveLength(0);
    });
  });

  describe('event history', () => {
    test('stores published events', async () => {
      await bus.publish('test.a', 1);
      await bus.publish('test.b', 2);
      const history = bus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].topic).toBe('test.a');
    });

    test('replay returns events matching pattern since timestamp', async () => {
      await bus.publish('agent.x', 'old');
      const cutoff = new Date().toISOString();
      await bus.publish('agent.y', 'new');
      const replayed = bus.replay('agent.*', cutoff);
      expect(replayed).toHaveLength(1);
      expect(replayed[0].data).toBe('new');
    });
  });

  describe('dead letter queue', () => {
    test('captures failed deliveries', async () => {
      bus.subscribe('fail.topic', () => { throw new Error('handler boom'); });
      await bus.publish('fail.topic', {});
      const dead = bus.getDeadLetters();
      expect(dead).toHaveLength(1);
      expect(dead[0].error).toBe('handler boom');
    });
  });

  describe('subscriber groups', () => {
    test('unsubscribeGroup removes all group subscriptions', async () => {
      const received: unknown[] = [];
      bus.subscribeWithGroup('myModule', 'test.*', (e) => { received.push(e.data); });
      bus.subscribeWithGroup('myModule', 'other.*', (e) => { received.push(e.data); });
      bus.unsubscribeGroup('myModule');
      await bus.publish('test.x', 1);
      await bus.publish('other.x', 2);
      expect(received).toHaveLength(0);
    });
  });

  describe('unsubscribe', () => {
    test('stops receiving events', async () => {
      const received: unknown[] = [];
      const id = bus.subscribe('test.x', (e) => { received.push(e.data); });
      await bus.publish('test.x', 1);
      bus.unsubscribe(id);
      await bus.publish('test.x', 2);
      expect(received).toEqual([1]);
    });
  });

  describe('subscription filters', () => {
    test('field-level filter restricts delivery', async () => {
      const received: unknown[] = [];
      bus.subscribe('task.*', (e) => { received.push(e.data); }, {
        filter: { 'data.status': 'completed' },
      });
      await bus.publish('task.update', { status: 'working' });
      await bus.publish('task.update', { status: 'completed' });
      expect(received).toEqual([{ status: 'completed' }]);
    });
  });

  describe('stats', () => {
    test('returns subscription and history counts', async () => {
      bus.subscribe('a.*', () => {});
      await bus.publish('a.b', 1);
      const stats = bus.getStats();
      expect(stats.subscriptions).toBe(1);
      expect(stats.historySize).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && bun test src/events/__tests__/bus.test.ts`
Expected: FAIL — `EventBus` not exported, methods don't exist.

- [ ] **Step 3: Implement EventBus class**

```typescript
// src/events/bus.ts
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
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1 hour
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

// Topic matching: * = one segment, # = zero or more segments
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

// Singleton — default instance for the app
export const eventBus = new EventBus();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && bun test src/events/__tests__/bus.test.ts`
Expected: All PASS.

- [ ] **Step 5: Update existing consumers to use new bus API**

The old bus used `eventBus.emit()` and `eventBus.on()`. The new bus uses `eventBus.publish()` and `eventBus.subscribe()`. Update these files:

- `src/events/publishers/index.ts` — change `.emit()` to `.publish()`
- `src/events/consumers/index.ts` — change `.on()` to `.subscribe()`
- `src/modules/skills/skills.dispatch.ts:36` — change `eventBus.emit()` to `eventBus.publish()`
- `src/infra/realtime/ws-server.ts` — change all `.on()` to `.subscribe()` and `.emit()` to `.publish()`
- `src/infra/realtime/sse-stream.ts` — change `.on()` / `.off()` to `.subscribe()` / `.unsubscribe()`
- `src/infra/a2a/task-manager.ts` — change all `eventBus.emit()` to `eventBus.publish()`

For each file, find `.emit(Topics.X, data)` → `.publish(Topics.X, data)` and `.on(topic, handler)` → `.subscribe(topic, handler)`.

- [ ] **Step 6: Run full test suite**

Run: `cd backend && bun test`
Expected: All tests pass (existing + new bus tests).

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/events/bus.ts src/events/__tests__/bus.test.ts src/events/publishers/index.ts src/events/consumers/index.ts src/modules/skills/skills.dispatch.ts src/infra/realtime/ws-server.ts src/infra/realtime/sse-stream.ts src/infra/a2a/task-manager.ts
git commit -m "feat(events): replace EventEmitter3 with topic-based event bus

Wildcard matching (*, #), event history with TTL, dead letter queue,
replay, subscriber groups, field-level filters."
```

---

### Task 2: Redis Pub/Sub for A2C Communication

**Files:**
- Create: `src/infra/redis/pubsub.ts`
- Test: `src/infra/redis/__tests__/pubsub.test.ts`

Bridges the in-memory event bus to Redis channels so external services and clients can subscribe to topics across processes.

- [ ] **Step 1: Write failing tests**

```typescript
// src/infra/redis/__tests__/pubsub.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { RedisPubSub } from '../pubsub';
import { EventBus } from '../../../events/bus';

// These tests mock Redis — no real Redis needed
describe('RedisPubSub', () => {
  let bus: EventBus;
  let published: Array<{ channel: string; message: string }>;
  let mockRedisPublisher: any;

  beforeEach(() => {
    bus = new EventBus();
    published = [];
    mockRedisPublisher = {
      publish: (channel: string, message: string) => {
        published.push({ channel, message });
        return Promise.resolve(1);
      },
    };
  });

  test('forwards bus events to Redis', async () => {
    const pubsub = new RedisPubSub(bus, mockRedisPublisher);
    pubsub.bridgeToRedis('task.*');

    await bus.publish('task.completed', { taskId: '123' });
    expect(published).toHaveLength(1);
    expect(published[0].channel).toBe('task.completed');
    const parsed = JSON.parse(published[0].message);
    expect(parsed.data.taskId).toBe('123');
  });

  test('does not forward non-matching topics', async () => {
    const pubsub = new RedisPubSub(bus, mockRedisPublisher);
    pubsub.bridgeToRedis('task.*');

    await bus.publish('agent.created', {});
    expect(published).toHaveLength(0);
  });

  test('multiple bridge patterns work independently', async () => {
    const pubsub = new RedisPubSub(bus, mockRedisPublisher);
    pubsub.bridgeToRedis('task.#');
    pubsub.bridgeToRedis('agent.*');

    await bus.publish('task.status.changed', {});
    await bus.publish('agent.created', {});
    await bus.publish('workflow.started', {}); // no match
    expect(published).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && bun test src/infra/redis/__tests__/pubsub.test.ts`
Expected: FAIL — `RedisPubSub` not found.

- [ ] **Step 3: Implement RedisPubSub**

```typescript
// src/infra/redis/pubsub.ts
import type { EventBus, BusEvent } from '../../events/bus';
import type Redis from 'ioredis';

export class RedisPubSub {
  private bridges: string[] = [];

  constructor(
    private bus: EventBus,
    private publisher: Pick<Redis, 'publish'>,
    private subscriber?: Pick<Redis, 'psubscribe' | 'on'>,
  ) {}

  /** Forward events matching a bus pattern to Redis channels */
  bridgeToRedis(pattern: string): string {
    return this.bus.subscribe(pattern, async (event) => {
      const message = JSON.stringify({
        id: event.id,
        topic: event.topic,
        data: event.data,
        source: event.source,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
      });
      await this.publisher.publish(event.topic, message);
    }, { name: `redis-bridge:${pattern}` });
  }

  /** Subscribe to Redis channels and inject into the bus */
  bridgeFromRedis(pattern: string): void {
    if (!this.subscriber) throw new Error('No Redis subscriber provided');
    this.subscriber.psubscribe(pattern);
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message);
        this.bus.publish(channel, parsed.data, {
          source: `redis:${parsed.source ?? 'external'}`,
          correlationId: parsed.correlationId,
        });
      } catch (err) {
        // Push parse failures to dead letters for debugging
        this.bus.publish('error.redis.parse', {
          channel,
          message: message.slice(0, 500),
          error: err instanceof Error ? err.message : String(err),
        }, { source: 'redis-bridge' });
      }
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && bun test src/infra/redis/__tests__/pubsub.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/infra/redis/pubsub.ts src/infra/redis/__tests__/pubsub.test.ts
git commit -m "feat(redis): add Redis pub/sub bridge for A2C communication

Bridges event bus topics to Redis channels for cross-service subscriptions."
```

---

### Task 3: Agent Collaboration Engine

**Files:**
- Create: `src/modules/collaboration/collaboration.types.ts`
- Create: `src/modules/collaboration/collaboration.engine.ts`
- Create: `src/modules/collaboration/index.ts`
- Test: `src/modules/collaboration/__tests__/collaboration.engine.test.ts`

Implements structured multi-agent patterns: fan-out, consensus, debate, map-reduce.

- [ ] **Step 1: Create types**

```typescript
// src/modules/collaboration/collaboration.types.ts
export type CollaborationStrategy = 'fan_out' | 'consensus' | 'debate' | 'map_reduce';
export type MergeStrategy = 'concat' | 'best_score' | 'majority_vote' | 'custom';

export interface CollaborationRequest {
  strategy: CollaborationStrategy;
  query: string;
  agents: string[];
  mergeStrategy?: MergeStrategy;
  maxRounds?: number;
  items?: unknown[];
  timeoutMs?: number;
  judgeAgent?: string;
  convergenceThreshold?: number;
}

export interface AgentResponse {
  agent: string;
  result: string;
  score?: number;
  durationMs: number;
  error?: string;
  round?: number;
}

export interface CollaborationResult {
  id: string;
  strategy: CollaborationStrategy;
  output: string;
  responses: AgentResponse[];
  agreement?: number;
  rounds?: number;
  convergedAt?: number;
  totalDurationMs: number;
  warning?: string;
}

export type CollabDispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
) => Promise<string>;

// TODO: Add domain-specific role injection (supply chain roles, etc.)
// This will allow collaboration strategies to inject context per agent
// based on their role in the domain (e.g., risk analyst, operations expert).
// Deferred — build general base first.
```

- [ ] **Step 2: Write failing tests for fan-out and consensus**

```typescript
// src/modules/collaboration/__tests__/collaboration.engine.test.ts
import { describe, test, expect } from 'bun:test';
import { collaborate } from '../collaboration.engine';
import type { CollabDispatchFn, CollaborationRequest } from '../collaboration.types';

const mockDispatch: CollabDispatchFn = async (skillId, args) => {
  return `Response from ${skillId}: ${JSON.stringify(args).slice(0, 50)}`;
};

describe('collaborate', () => {
  test('fan_out: queries all agents and concatenates results', async () => {
    const result = await collaborate({
      strategy: 'fan_out',
      query: 'What is 2+2?',
      agents: ['agent-a', 'agent-b'],
    }, mockDispatch);

    expect(result.strategy).toBe('fan_out');
    expect(result.responses).toHaveLength(2);
    expect(result.output).toContain('agent-a');
    expect(result.output).toContain('agent-b');
  });

  test('fan_out: handles agent errors gracefully', async () => {
    const failDispatch: CollabDispatchFn = async (skillId) => {
      if (skillId === 'agent-bad') throw new Error('agent down');
      return `ok from ${skillId}`;
    };
    const result = await collaborate({
      strategy: 'fan_out',
      query: 'test',
      agents: ['agent-good', 'agent-bad'],
    }, failDispatch);

    expect(result.responses.find(r => r.agent === 'agent-bad')?.error).toBe('agent down');
    expect(result.output).toContain('agent-good');
  });

  test('consensus: picks highest-scored response', async () => {
    let callCount = 0;
    const scoringDispatch: CollabDispatchFn = async (skillId, args) => {
      callCount++;
      if (skillId === 'agent-a') return 'Good answer';
      if (skillId === 'agent-b') return 'Great answer';
      // Judge call
      return JSON.stringify({
        scores: [{ id: 0, score: 6, reason: 'ok' }, { id: 1, score: 9, reason: 'great' }],
        bestId: 1,
        agreement: 0.7,
      });
    };
    const result = await collaborate({
      strategy: 'consensus',
      query: 'Best approach?',
      agents: ['agent-a', 'agent-b'],
      judgeAgent: 'judge',
    }, scoringDispatch);

    expect(result.strategy).toBe('consensus');
    expect(result.output).toContain('Great answer');
  });

  test('map_reduce: distributes items and aggregates', async () => {
    const result = await collaborate({
      strategy: 'map_reduce',
      query: 'Analyze this item',
      agents: ['agent-a'],
      items: ['item1', 'item2', 'item3'],
    }, mockDispatch);

    expect(result.strategy).toBe('map_reduce');
    expect(result.responses.length).toBeGreaterThanOrEqual(3);
  });

  test('debate: iterates rounds until convergence or max', async () => {
    const result = await collaborate({
      strategy: 'debate',
      query: 'Best solution?',
      agents: ['agent-a', 'agent-b'],
      maxRounds: 2,
    }, mockDispatch);

    expect(result.strategy).toBe('debate');
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.rounds).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && bun test src/modules/collaboration/__tests__/collaboration.engine.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement collaboration engine**

```typescript
// src/modules/collaboration/collaboration.engine.ts
import { nanoid } from 'nanoid';
import type {
  CollaborationRequest, CollaborationResult, AgentResponse, CollabDispatchFn,
} from './collaboration.types';

export async function collaborate(
  request: CollaborationRequest,
  dispatch: CollabDispatchFn,
): Promise<CollaborationResult> {
  const startTime = Date.now();
  const id = nanoid();

  switch (request.strategy) {
    case 'fan_out': return fanOut(id, request, dispatch, startTime);
    case 'consensus': return consensus(id, request, dispatch, startTime);
    case 'debate': return debate(id, request, dispatch, startTime);
    case 'map_reduce': return mapReduce(id, request, dispatch, startTime);
    default: throw new Error(`Unknown strategy: ${request.strategy}`);
  }
}

async function queryAgents(
  agents: string[], query: string, dispatch: CollabDispatchFn, timeoutMs = 60_000,
): Promise<AgentResponse[]> {
  return Promise.all(agents.map(async (agent) => {
    const start = Date.now();
    try {
      const result = await Promise.race([
        dispatch(agent, { prompt: query }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
      return { agent, result, durationMs: Date.now() - start };
    } catch (err) {
      return { agent, result: '', durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }));
}

async function fanOut(
  id: string, req: CollaborationRequest, dispatch: CollabDispatchFn, startTime: number,
): Promise<CollaborationResult> {
  const responses = await queryAgents(req.agents, req.query, dispatch, req.timeoutMs);
  const valid = responses.filter(r => !r.error);
  const output = valid.map(r => `[${r.agent}]\n${r.result}`).join('\n\n---\n\n');
  return { id, strategy: 'fan_out', output, responses, totalDurationMs: Date.now() - startTime };
}

async function consensus(
  id: string, req: CollaborationRequest, dispatch: CollabDispatchFn, startTime: number,
): Promise<CollaborationResult> {
  const responses = await queryAgents(req.agents, req.query, dispatch, req.timeoutMs);
  const valid = responses.filter(r => !r.error);
  if (valid.length <= 1) {
    return { id, strategy: 'consensus', output: valid[0]?.result ?? '', responses, agreement: 1, totalDurationMs: Date.now() - startTime };
  }

  const responseSummary = valid.map((r, i) => `<option id="${i}" agent="${r.agent}">\n${r.result}\n</option>`).join('\n');
  const judgeAgent = req.judgeAgent ?? valid[0].agent;
  const scoringPrompt = `Rate each response (1-10) and pick the best. Reply with JSON: { "scores": [{"id": 0, "score": N, "reason": "..."}], "bestId": N, "agreement": 0.0-1.0 }\n\n<query>${req.query}</query>\n<responses>\n${responseSummary}\n</responses>`;

  let bestIdx = 0;
  let agreement = 0;
  try {
    const judgeResult = await dispatch(judgeAgent, { prompt: scoringPrompt });
    const parsed = JSON.parse(judgeResult.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    bestIdx = parsed.bestId ?? 0;
    agreement = parsed.agreement ?? 0;
    if (parsed.scores) {
      for (const s of parsed.scores) {
        const r = valid[s.id];
        if (r) r.score = s.score;
      }
    }
  } catch {}

  return {
    id, strategy: 'consensus',
    output: valid[bestIdx]?.result ?? valid[0].result,
    responses, agreement, totalDurationMs: Date.now() - startTime,
  };
}

async function debate(
  id: string, req: CollaborationRequest, dispatch: CollabDispatchFn, startTime: number,
): Promise<CollaborationResult> {
  const maxRounds = req.maxRounds ?? 2;
  const threshold = req.convergenceThreshold ?? 0.85;
  let allResponses: AgentResponse[] = [];
  let previousOutputs = new Map<string, string>();

  for (let round = 1; round <= maxRounds; round++) {
    const prompt = round === 1
      ? req.query
      : `Previous responses:\n${Array.from(previousOutputs.entries()).map(([a, r]) => `[${a}]: ${r}`).join('\n\n')}\n\nRefine your answer considering the above. Original query: ${req.query}`;

    const responses = await queryAgents(req.agents, prompt, dispatch, req.timeoutMs);
    responses.forEach(r => { r.round = round; });
    allResponses.push(...responses);

    const valid = responses.filter(r => !r.error);
    for (const r of valid) previousOutputs.set(r.agent, r.result);

    // Check convergence
    if (valid.length >= 2) {
      const similarity = averagePairwiseSimilarity(valid);
      if (similarity >= threshold) {
        return {
          id, strategy: 'debate',
          output: valid.map(r => `[${r.agent}]\n${r.result}`).join('\n\n---\n\n'),
          responses: allResponses, rounds: round, convergedAt: round,
          totalDurationMs: Date.now() - startTime,
        };
      }
    }
  }

  const lastRound = allResponses.filter(r => r.round === maxRounds && !r.error);
  return {
    id, strategy: 'debate',
    output: lastRound.map(r => `[${r.agent}]\n${r.result}`).join('\n\n---\n\n'),
    responses: allResponses, rounds: maxRounds,
    totalDurationMs: Date.now() - startTime,
  };
}

async function mapReduce(
  id: string, req: CollaborationRequest, dispatch: CollabDispatchFn, startTime: number,
): Promise<CollaborationResult> {
  const items = req.items ?? [];
  const agents = req.agents;
  const responses: AgentResponse[] = [];

  // Distribute items round-robin across agents
  const tasks = items.map((item, i) => ({
    agent: agents[i % agents.length],
    item,
  }));

  await Promise.all(tasks.map(async ({ agent, item }) => {
    const start = Date.now();
    try {
      const result = await dispatch(agent, { prompt: req.query, item });
      responses.push({ agent, result, durationMs: Date.now() - start });
    } catch (err) {
      responses.push({ agent, result: '', durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) });
    }
  }));

  const output = responses.filter(r => !r.error).map(r => r.result).join('\n\n');
  return { id, strategy: 'map_reduce', output, responses, totalDurationMs: Date.now() - startTime };
}

function averagePairwiseSimilarity(responses: AgentResponse[]): number {
  const valid = responses.filter(r => !r.error && r.result.length > 0);
  if (valid.length < 2) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      total += computeSimilarity(valid[i].result, valid[j].result);
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : 1;
}

function computeSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  return intersection.size / Math.max(setA.size, setB.size);
}
```

- [ ] **Step 5: Create barrel export**

```typescript
// src/modules/collaboration/index.ts
export { collaborate } from './collaboration.engine';
export type {
  CollaborationRequest, CollaborationResult, AgentResponse, CollabDispatchFn,
} from './collaboration.types';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && bun test src/modules/collaboration/__tests__/collaboration.engine.test.ts`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/modules/collaboration/
git commit -m "feat(collaboration): add multi-agent collaboration engine

Fan-out, consensus, debate with convergence, map-reduce strategies."
```

---

### Task 4: Workflow Engine — DAG Orchestration

**Files:**
- Create: `src/modules/workflows/workflows.types.ts`
- Create: `src/modules/workflows/workflows.templates.ts`
- Create: `src/modules/workflows/workflows.engine.ts`
- Create: `src/modules/workflows/index.ts`
- Test: `src/modules/workflows/__tests__/workflows.engine.test.ts`

DAG-based multi-step orchestration. Steps declare `dependsOn`, engine runs them in topological order with max parallelism. Step outputs feed into downstream steps via `{{stepId.result}}` templates.

- [ ] **Step 1: Create types**

```typescript
// src/modules/workflows/workflows.types.ts
export interface WorkflowStep {
  id: string;
  skillId: string;
  args?: Record<string, unknown>;
  message?: string;
  dependsOn?: string[];
  onError?: 'fail' | 'skip' | 'retry';
  maxRetries?: number;
  when?: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  name?: string;
  description?: string;
  steps: WorkflowStep[];
  maxConcurrency?: number;
}

export interface StepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  durationMs: number;
  retries?: number;
}

export interface WorkflowResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'partial';
  steps: StepResult[];
  totalDurationMs: number;
}

export type WorkflowDispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
  text: string,
) => Promise<string>;
```

- [ ] **Step 2: Create template resolver**

```typescript
// src/modules/workflows/workflows.templates.ts
const MAX_SUBSTITUTION_LENGTH = 50_000;

/** Skills that need shell-safe escaping */
const SHELL_SKILLS = new Set(['run_shell', 'run_command', 'exec']);
/** Skills that need prompt injection protection */
const LLM_SKILLS = new Set(['ask_claude', 'ask_llm', 'generate']);

export function resolveTemplate(
  value: unknown,
  stepResults: Map<string, string>,
  input?: Record<string, unknown>,
  skillId?: string,
): unknown {
  if (typeof value === 'string') {
    let resolved = value.replace(/\{\{(\w+)\.result\}\}/g, (_match, stepId) => {
      let result = stepResults.get(stepId) ?? '';
      if (result.length > MAX_SUBSTITUTION_LENGTH) result = result.slice(0, MAX_SUBSTITUTION_LENGTH);
      // Strip null bytes and control chars
      result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      // Security: sanitize based on target skill type
      if (skillId && SHELL_SKILLS.has(skillId) && value !== `{{${stepId}.result}}`) {
        // Embedded in shell command — escape single quotes
        return result.replace(/'/g, "'\\''");
      }
      if (skillId && LLM_SKILLS.has(skillId)) {
        // Wrap in XML tags to prevent prompt injection
        return `<step_result source="${stepId}">${result}</step_result>`;
      }
      return result;
    }).replace(/\{\{input\.(\w+)\}\}/g, (_match, key) => {
      const val = input?.[key];
      return val != null ? String(val) : '';
    });
    return resolved;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      resolved[k] = resolveTemplate(v, stepResults, input, skillId);
    }
    return resolved;
  }
  return value;
}

/** Evaluate a `when` expression against step results and input */
export function evaluateWhen(
  expr: string,
  stepResults: Map<string, string>,
  stepStatuses: Map<string, string>,
  input?: Record<string, unknown>,
): boolean {
  // Resolve {{stepId.result}} and {{stepId.status}} references
  const resolved = expr
    .replace(/\{\{(\w+)\.result\}\}/g, (_m, id) => JSON.stringify(stepResults.get(id) ?? ''))
    .replace(/\{\{(\w+)\.status\}\}/g, (_m, id) => JSON.stringify(stepStatuses.get(id) ?? 'unknown'))
    .replace(/\{\{input\.(\w+)\}\}/g, (_m, key) => JSON.stringify(input?.[key] ?? ''));
  // Evaluate: falsy values = skip
  const val = resolved.trim();
  return val !== '' && val !== 'false' && val !== '0' && val !== '"false"' && val !== '"0"' && val !== '""';
}
```

- [ ] **Step 3: Write failing tests**

```typescript
// src/modules/workflows/__tests__/workflows.engine.test.ts
import { describe, test, expect } from 'bun:test';
import { executeWorkflow } from '../workflows.engine';
import type { WorkflowDefinition, WorkflowDispatchFn } from '../workflows.types';

const dispatch: WorkflowDispatchFn = async (skillId, args, text) => {
  return `${skillId}:${text || JSON.stringify(args)}`;
};

describe('executeWorkflow', () => {
  test('executes steps in dependency order', async () => {
    const workflow: WorkflowDefinition = {
      id: 'test-1',
      steps: [
        { id: 'a', skillId: 'echo', message: 'first' },
        { id: 'b', skillId: 'echo', message: 'second:{{a.result}}', dependsOn: ['a'] },
      ],
    };
    const result = await executeWorkflow(workflow, dispatch);
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].stepId).toBe('a');
    expect(result.steps[1].result).toContain('echo:first');
  });

  test('runs independent steps in parallel', async () => {
    const order: string[] = [];
    const parallelDispatch: WorkflowDispatchFn = async (skillId, _args, text) => {
      order.push(skillId);
      return `${skillId}:${text}`;
    };
    const workflow: WorkflowDefinition = {
      id: 'parallel',
      steps: [
        { id: 'a', skillId: 'fast-a', message: 'go' },
        { id: 'b', skillId: 'fast-b', message: 'go' },
        { id: 'c', skillId: 'slow', message: '{{a.result}}+{{b.result}}', dependsOn: ['a', 'b'] },
      ],
    };
    const result = await executeWorkflow(workflow, parallelDispatch);
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(3);
    // c must come after a and b
    const cIdx = result.steps.findIndex(s => s.stepId === 'c');
    const aIdx = result.steps.findIndex(s => s.stepId === 'a');
    const bIdx = result.steps.findIndex(s => s.stepId === 'b');
    expect(cIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);
  });

  test('skip step on error when onError=skip', async () => {
    const failDispatch: WorkflowDispatchFn = async (skillId) => {
      if (skillId === 'fail') throw new Error('boom');
      return 'ok';
    };
    const workflow: WorkflowDefinition = {
      id: 'skip-test',
      steps: [
        { id: 'a', skillId: 'fail', message: 'x', onError: 'skip' },
        { id: 'b', skillId: 'echo', message: 'after' },
      ],
    };
    const result = await executeWorkflow(workflow, failDispatch);
    expect(result.steps[0].status).toBe('skipped');
    expect(result.steps[1].status).toBe('completed');
    expect(result.status).toBe('partial');
  });

  test('fail workflow when step fails with onError=fail', async () => {
    const failDispatch: WorkflowDispatchFn = async () => { throw new Error('boom'); };
    const workflow: WorkflowDefinition = {
      id: 'fail-test',
      steps: [
        { id: 'a', skillId: 'fail', message: 'x', onError: 'fail' },
        { id: 'b', skillId: 'echo', message: 'after', dependsOn: ['a'] },
      ],
    };
    const result = await executeWorkflow(workflow, failDispatch);
    expect(result.status).toBe('failed');
    expect(result.steps.find(s => s.stepId === 'a')?.status).toBe('failed');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && bun test src/modules/workflows/__tests__/workflows.engine.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement workflow engine**

```typescript
// src/modules/workflows/workflows.engine.ts
import type {
  WorkflowDefinition, WorkflowResult, StepResult, WorkflowDispatchFn,
} from './workflows.types';
import { resolveTemplate, evaluateWhen } from './workflows.templates';

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  dispatch: WorkflowDispatchFn,
  input?: Record<string, unknown>,
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const stepResults = new Map<string, string>();
  const stepStatuses = new Map<string, string>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const results: StepResult[] = [];
  const maxConcurrency = workflow.maxConcurrency ?? 5;

  const steps = new Map(workflow.steps.map(s => [s.id, s]));

  function getReady(): string[] {
    const ready: string[] = [];
    for (const [id, step] of steps) {
      if (completed.has(id) || failed.has(id)) continue;
      const deps = step.dependsOn ?? [];
      const depsOk = deps.every(d => completed.has(d));
      const depsBlocked = deps.some(d => failed.has(d));
      if (depsBlocked && step.onError !== 'skip') {
        failed.add(id);
        stepStatuses.set(id, 'failed');
        results.push({ stepId: id, status: 'failed', error: 'dependency failed', durationMs: 0 });
        continue;
      }
      if (depsOk || (depsBlocked && step.onError === 'skip')) ready.push(id);
    }
    return ready;
  }

  while (completed.size + failed.size < steps.size) {
    const ready = getReady();
    if (ready.length === 0) break;

    const batch = ready.slice(0, maxConcurrency);
    await Promise.all(batch.map(async (stepId) => {
      const step = steps.get(stepId)!;
      const start = Date.now();

      // Evaluate `when` conditional — skip step if falsy
      if (step.when) {
        const shouldRun = evaluateWhen(step.when, stepResults, stepStatuses, input);
        if (!shouldRun) {
          completed.add(stepId);
          stepStatuses.set(stepId, 'skipped');
          results.push({ stepId, status: 'skipped', durationMs: Date.now() - start });
          return;
        }
      }

      const resolvedArgs = (step.args ? resolveTemplate(step.args, stepResults, input, step.skillId) : {}) as Record<string, unknown>;
      const resolvedMsg = step.message ? resolveTemplate(step.message, stepResults, input, step.skillId) as string : '';
      const maxRetries = step.onError === 'retry' ? Math.min(step.maxRetries ?? 2, 5) : 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Exponential backoff on retries (capped at 30s)
          if (attempt > 0) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
            await new Promise(r => setTimeout(r, delay));
          }
          const result = await dispatch(step.skillId, resolvedArgs, resolvedMsg);
          stepResults.set(stepId, result);
          stepStatuses.set(stepId, 'completed');
          completed.add(stepId);
          results.push({ stepId, status: 'completed', result, durationMs: Date.now() - start, retries: attempt > 0 ? attempt : undefined });
          return;
        } catch (err) {
          if (attempt === maxRetries) {
            const error = err instanceof Error ? err.message : String(err);
            if (step.onError === 'skip') {
              completed.add(stepId);
              stepStatuses.set(stepId, 'skipped');
              results.push({ stepId, status: 'skipped', error, durationMs: Date.now() - start });
            } else {
              failed.add(stepId);
              stepStatuses.set(stepId, 'failed');
              results.push({ stepId, status: 'failed', error, durationMs: Date.now() - start });
            }
          }
        }
      }
    }));
  }

  const hasFailures = results.some(r => r.status === 'failed');
  const hasSkips = results.some(r => r.status === 'skipped');
  const status = hasFailures ? 'failed' : hasSkips ? 'partial' : 'completed';

  return { workflowId: workflow.id, status, steps: results, totalDurationMs: Date.now() - startTime };
}
```

- [ ] **Step 6: Create barrel export**

```typescript
// src/modules/workflows/index.ts
export { executeWorkflow } from './workflows.engine';
export { resolveTemplate } from './workflows.templates';
export type { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult, WorkflowDispatchFn } from './workflows.types';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && bun test src/modules/workflows/__tests__/workflows.engine.test.ts`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/modules/workflows/
git commit -m "feat(workflows): add DAG-based workflow engine

Topological step ordering, parallel execution, template substitution,
retry/skip/fail error handling per step."
```

---

### Task 5: Skill Composer — Declarative Pipeline Chaining

**Files:**
- Create: `src/modules/skills/skills.composer.types.ts`
- Create: `src/modules/skills/skills.composer.ts`
- Test: `src/modules/skills/__tests__/skills.composer.test.ts`

Pipe-style skill chaining: each step's output feeds the next. Simpler than the full workflow engine — no DAG, just linear pipelines.

- [ ] **Step 1: Create types**

```typescript
// src/modules/skills/skills.composer.types.ts
export interface PipelineStep {
  skillId: string;
  args?: Record<string, unknown>;
  transform?: string;
  as?: string;
  when?: string;
  onError?: 'abort' | 'skip' | { fallback: unknown };
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  createdAt: string;
}

export interface PipelineStepResult {
  skillId: string;
  alias?: string;
  status: 'completed' | 'skipped' | 'failed' | 'fallback';
  result?: string;
  error?: string;
  durationMs: number;
}

export interface PipelineResult {
  pipelineId: string;
  status: 'completed' | 'failed' | 'partial';
  output: unknown;
  stepResults: PipelineStepResult[];
  totalDurationMs: number;
}

export type PipelineDispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
  text: string,
) => Promise<string>;
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/modules/skills/__tests__/skills.composer.test.ts
import { describe, test, expect } from 'bun:test';
import { compose, executePipeline } from '../skills.composer';
import type { PipelineDispatchFn } from '../skills.composer.types';

const dispatch: PipelineDispatchFn = async (skillId, args, text) => {
  if (skillId === 'upper') return (text || '').toUpperCase();
  if (skillId === 'wrap') return `[${text || JSON.stringify(args)}]`;
  if (skillId === 'fail') throw new Error('fail');
  return `${skillId}:${text}`;
};

describe('Skill Composer', () => {
  test('compose creates a pipeline', () => {
    const pipeline = compose('test', [{ skillId: 'echo' }]);
    expect(pipeline.name).toBe('test');
    expect(pipeline.steps).toHaveLength(1);
  });

  test('executePipeline chains step outputs', async () => {
    const pipeline = compose('chain', [
      { skillId: 'echo', transform: 'hello' },
      { skillId: 'upper', transform: '{{prev.result}}' },
      { skillId: 'wrap', transform: '{{prev.result}}' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('[ECHO:HELLO]');
  });

  test('abort on error stops pipeline', async () => {
    const pipeline = compose('abort', [
      { skillId: 'echo', transform: 'ok' },
      { skillId: 'fail', transform: 'x', onError: 'abort' },
      { skillId: 'echo', transform: 'never' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('failed');
    expect(result.stepResults).toHaveLength(2);
  });

  test('skip on error continues pipeline', async () => {
    const pipeline = compose('skip', [
      { skillId: 'fail', transform: 'x', onError: 'skip' },
      { skillId: 'echo', transform: 'after' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('partial');
    expect(result.stepResults[0].status).toBe('skipped');
    expect(result.stepResults[1].status).toBe('completed');
  });

  test('fallback on error uses fallback value', async () => {
    const pipeline = compose('fallback', [
      { skillId: 'fail', transform: 'x', onError: { fallback: 'default' } },
      { skillId: 'upper', transform: '{{prev.result}}' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('DEFAULT');
  });

  test('{{input.*}} resolves from initial input', async () => {
    const pipeline = compose('input', [
      { skillId: 'echo', transform: '{{input.name}}' },
    ]);
    const result = await executePipeline(pipeline, { name: 'world' }, dispatch);
    expect(result.output).toBe('echo:world');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && bun test src/modules/skills/__tests__/skills.composer.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement skill composer**

```typescript
// src/modules/skills/skills.composer.ts
import { nanoid } from 'nanoid';
import type {
  Pipeline, PipelineStep, PipelineResult, PipelineStepResult, PipelineDispatchFn,
} from './skills.composer.types';

export function compose(name: string, steps: PipelineStep[], description?: string): Pipeline {
  return {
    id: nanoid(),
    name,
    description,
    steps,
    createdAt: new Date().toISOString(),
  };
}

export async function executePipeline(
  pipeline: Pipeline,
  input: Record<string, unknown>,
  dispatch: PipelineDispatchFn,
): Promise<PipelineResult> {
  const startTime = Date.now();
  const stepResults: PipelineStepResult[] = [];
  const stepOutputs = new Map<string, string>();
  let prevResult = '';
  let aborted = false;
  let hasSkip = false;

  for (const step of pipeline.steps) {
    if (aborted) break;
    const start = Date.now();

    // Resolve templates
    const text = step.transform
      ? resolveTemplates(step.transform, prevResult, stepOutputs, input)
      : '';
    const args = step.args
      ? JSON.parse(resolveTemplates(JSON.stringify(step.args), prevResult, stepOutputs, input))
      : {};

    try {
      const result = await dispatch(step.skillId, args, text);
      prevResult = result;
      if (step.as) stepOutputs.set(step.as, result);
      stepResults.push({ skillId: step.skillId, alias: step.as, status: 'completed', result, durationMs: Date.now() - start });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const onError = step.onError ?? 'abort';

      if (onError === 'abort') {
        stepResults.push({ skillId: step.skillId, alias: step.as, status: 'failed', error, durationMs: Date.now() - start });
        aborted = true;
      } else if (onError === 'skip') {
        hasSkip = true;
        stepResults.push({ skillId: step.skillId, alias: step.as, status: 'skipped', error, durationMs: Date.now() - start });
        // prevResult stays the same — skip this step's output
      } else if (typeof onError === 'object' && 'fallback' in onError) {
        const fallback = String(onError.fallback);
        prevResult = fallback;
        if (step.as) stepOutputs.set(step.as, fallback);
        stepResults.push({ skillId: step.skillId, alias: step.as, status: 'fallback', result: fallback, durationMs: Date.now() - start });
      }
    }
  }

  const status = aborted ? 'failed' : hasSkip ? 'partial' : 'completed';
  return {
    pipelineId: pipeline.id,
    status,
    output: prevResult,
    stepResults,
    totalDurationMs: Date.now() - startTime,
  };
}

function resolveTemplates(
  text: string,
  prevResult: string,
  stepOutputs: Map<string, string>,
  input: Record<string, unknown>,
): string {
  return text
    .replace(/\{\{prev\.result\}\}/g, prevResult)
    .replace(/\{\{steps\.(\w+)\.result\}\}/g, (_m, alias) => stepOutputs.get(alias) ?? '')
    .replace(/\{\{input\.(\w+)\}\}/g, (_m, key) => input[key] != null ? String(input[key]) : '');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && bun test src/modules/skills/__tests__/skills.composer.test.ts`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/modules/skills/skills.composer.ts src/modules/skills/skills.composer.types.ts src/modules/skills/__tests__/skills.composer.test.ts
git commit -m "feat(skills): add declarative skill composer for pipeline chaining

compose() + executePipeline() with {{prev.result}}, {{input.*}} templates,
abort/skip/fallback error handling."
```

---

### Task 6: Expand Topics + Wire Routes

**Files:**
- Modify: `src/events/topics.ts`
- Create: `src/modules/collaboration/collaboration.routes.ts`
- Create: `src/modules/workflows/workflows.routes.ts`
- Modify: `src/api/routes/workspace/index.ts`

- [ ] **Step 1: Add domain event topics**

```typescript
// src/events/topics.ts — ADD these to the existing Topics object
// after the existing topics, add:

  // Collaboration
  COLLAB_STARTED: 'collaboration.started',
  COLLAB_COMPLETED: 'collaboration.completed',

  // Workflows
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_STEP_COMPLETED: 'workflow.step.completed',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',

  // TODO: Domain events — deferred (build general base first)
  // DOMAIN_ENTITY_CREATED: 'ontology.entity.created',
  // DOMAIN_ENTITY_UPDATED: 'ontology.entity.updated',
  // DOMAIN_ENTITY_DELETED: 'ontology.entity.deleted',
  // DOMAIN_RELATIONSHIP_CREATED: 'ontology.relationship.created',
  // DOMAIN_RELATIONSHIP_REMOVED: 'ontology.relationship.removed',

  // TODO: Supply chain alerts — deferred (needs domain events skeleton)
  // SC_ALERT_CRITICAL: 'supply-chain.alert.critical',
  // SC_ALERT_WARNING: 'supply-chain.alert.warning',
  // SC_ANOMALY_STOCKOUT: 'supply-chain.anomaly.stockout-risk',
  // SC_ANOMALY_PRICE_SPIKE: 'supply-chain.anomaly.price-spike',
  // SC_ANOMALY_DELIVERY_DELAY: 'supply-chain.anomaly.delivery-delay',
```

- [ ] **Step 2: Create collaboration route**

```typescript
// src/modules/collaboration/collaboration.routes.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod/v4';
import { collaborate } from './collaboration.engine';
import { dispatchSkill } from '../skills/skills.dispatch';
import type { CollabDispatchFn } from './collaboration.types';

const collaborateSchema = z.object({
  strategy: z.enum(['fan_out', 'consensus', 'debate', 'map_reduce']),
  query: z.string().min(1),
  agents: z.array(z.string()).min(1),
  mergeStrategy: z.enum(['concat', 'best_score', 'majority_vote', 'custom']).optional(),
  maxRounds: z.number().int().min(1).max(10).optional(),
  items: z.array(z.unknown()).optional(),
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  judgeAgent: z.string().optional(),
  convergenceThreshold: z.number().min(0).max(1).optional(),
});

const collaborateRoute = createRoute({
  method: 'post',
  path: '/collaborate',
  request: { body: { content: { 'application/json': { schema: collaborateSchema } } } },
  responses: { 200: { description: 'Collaboration result', content: { 'application/json': { schema: z.object({}).passthrough() } } } },
});

export const CollaborationRoutes = new OpenAPIHono();

CollaborationRoutes.openapi(collaborateRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;

  const dispatch: CollabDispatchFn = async (skillId, args) => {
    const result = await dispatchSkill(skillId, args as Record<string, unknown>, {
      callerId, workspaceId, callerRole: 'agent',
    });
    if (!result.ok) throw new Error(result.error.message);
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  };

  const result = await collaborate(body, dispatch);
  return c.json(result);
});
```

- [ ] **Step 3: Create workflow route**

```typescript
// src/modules/workflows/workflows.routes.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod/v4';
import { executeWorkflow } from './workflows.engine';
import { dispatchSkill } from '../skills/skills.dispatch';
import type { WorkflowDispatchFn } from './workflows.types';

const workflowStepSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  args: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  onError: z.enum(['fail', 'skip', 'retry']).optional(),
  maxRetries: z.number().int().min(1).max(5).optional(),
  when: z.string().optional(),
  label: z.string().optional(),
});

const runWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  steps: z.array(workflowStepSchema).min(1),
  maxConcurrency: z.number().int().min(1).max(50).optional(),
  input: z.record(z.unknown()).optional(),
});

const runWorkflowRoute = createRoute({
  method: 'post',
  path: '/run',
  request: { body: { content: { 'application/json': { schema: runWorkflowSchema } } } },
  responses: { 200: { description: 'Workflow result', content: { 'application/json': { schema: z.object({}).passthrough() } } } },
});

export const WorkflowRoutes = new OpenAPIHono();

WorkflowRoutes.openapi(runWorkflowRoute, async (c) => {
  const body = c.req.valid('json');
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;

  const dispatch: WorkflowDispatchFn = async (skillId, args, text) => {
    const mergedArgs = text ? { ...args, prompt: text } : args;
    const result = await dispatchSkill(skillId, mergedArgs, {
      callerId, workspaceId, callerRole: 'agent',
    });
    if (!result.ok) throw new Error(result.error.message);
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  };

  const result = await executeWorkflow(body, dispatch, body.input);
  return c.json(result);
});
```

- [ ] **Step 4: Mount routes in workspace router**

Add to `src/api/routes/workspace/index.ts`:

```typescript
import { CollaborationRoutes } from '../../../modules/collaboration/collaboration.routes';
import { WorkflowRoutes } from '../../../modules/workflows/workflows.routes';

// Add after existing route mounts:
workspaceRoutes.route('/collaboration', CollaborationRoutes);
workspaceRoutes.route('/workflows', WorkflowRoutes);
```

- [ ] **Step 5: Run full test suite**

Run: `cd backend && bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/events/topics.ts src/modules/collaboration/collaboration.routes.ts src/modules/workflows/workflows.routes.ts src/api/routes/workspace/index.ts
git commit -m "feat(routes): mount collaboration and workflow endpoints, expand event topics

POST /collaboration/collaborate, POST /workflows/run, domain event topics."
```

---

### Task 7: Full Integration Test

**Files:**
- Test: `src/__tests__/integration.test.ts`

End-to-end test verifying the event bus, collaboration, and workflow work together.

- [ ] **Step 1: Write integration test**

```typescript
// src/__tests__/integration.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { EventBus } from '../events/bus';
import { RedisPubSub } from '../infra/redis/pubsub';
import { collaborate } from '../modules/collaboration/collaboration.engine';
import { executeWorkflow } from '../modules/workflows/workflows.engine';
import { compose, executePipeline } from '../modules/skills/skills.composer';

describe('Integration', () => {
  test('event bus → redis bridge → collaboration', async () => {
    const bus = new EventBus();
    const published: string[] = [];
    const mockRedis = { publish: async (_c: string, m: string) => { published.push(m); return 1; } };
    const pubsub = new RedisPubSub(bus, mockRedis);
    pubsub.bridgeToRedis('collaboration.#');

    const dispatch = async (skillId: string, args: Record<string, unknown>) => `${skillId} says hello`;
    const result = await collaborate({
      strategy: 'fan_out',
      query: 'test',
      agents: ['a', 'b'],
    }, dispatch);

    // Emit collaboration result through bus
    await bus.publish('collaboration.completed', { id: result.id, output: result.output });
    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0]).data.id).toBe(result.id);
  });

  test('workflow engine chains skills with template substitution', async () => {
    const dispatch = async (skillId: string, args: Record<string, unknown>, text: string) => {
      if (skillId === 'greet') return `Hello ${text}`;
      if (skillId === 'upper') return text.toUpperCase();
      return text;
    };
    const result = await executeWorkflow({
      id: 'greet-flow',
      steps: [
        { id: 'greet', skillId: 'greet', message: 'World' },
        { id: 'shout', skillId: 'upper', message: '{{greet.result}}', dependsOn: ['greet'] },
      ],
    }, dispatch);

    expect(result.status).toBe('completed');
    expect(result.steps[1].result).toBe('HELLO WORLD');
  });

  test('skill composer pipeline with fallback', async () => {
    const dispatch = async (skillId: string, _args: Record<string, unknown>, text: string) => {
      if (skillId === 'fail') throw new Error('down');
      return `${skillId}(${text})`;
    };
    const pipeline = compose('resilient', [
      { skillId: 'fail', transform: 'x', onError: { fallback: 'safe' } },
      { skillId: 'wrap', transform: '{{prev.result}}' },
    ]);
    const result = await executePipeline(pipeline, {}, dispatch);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('wrap(safe)');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd backend && bun test`
Expected: All tests pass (existing + new).

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/__tests__/integration.test.ts
git commit -m "test: add integration tests for event bus, collaboration, workflows, composer"
```

---

## Verification Checklist

After all tasks are complete:

1. `bun test` — all tests pass
2. Event bus supports `*` and `#` wildcards with dead letter queue
3. Redis pub/sub bridges events for external clients (A2C)
4. `POST /collaboration/collaborate` with fan_out/consensus/debate/map_reduce
5. `POST /workflows/run` with DAG execution and `{{stepId.result}}` templates
6. Skill composer chains skills with `{{prev.result}}`, abort/skip/fallback
7. All new code committed on feature branch with topic-scoped commits
