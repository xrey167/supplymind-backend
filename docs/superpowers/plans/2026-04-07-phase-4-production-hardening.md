# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenTelemetry metrics, per-plugin rate limits, plugin health-check worker, dead-letter replay, and sync-jobs CRUD routes to make the platform production-ready.

**Architecture:** Metrics are emitted via a thin `src/infra/observability/metrics.ts` wrapper over `@opentelemetry/api`; rate limits are configured in `src/api/middlewares/rate-limit.ts` and applied per-plugin at the Hono route layer; the health-check worker is a repeatable BullMQ job; dead-letter replay and sync-jobs routes complete the ERP BC plugin REST surface.

**Tech Stack:** Bun, Hono, Drizzle ORM, BullMQ, ioredis, @opentelemetry/api, @opentelemetry/sdk-node, zod

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/infra/observability/metrics.ts` | Create | OTel meter, counters, histograms |
| `src/infra/observability/index.ts` | Create | Re-export, SDK init helper |
| `src/api/middlewares/rate-limit.ts` | Modify | Export `PLUGIN_RATE_LIMITS` constant + per-plugin config |
| `src/infra/queue/workers/plugin-health.worker.ts` | Create | Repeatable BullMQ worker: run health checks for all enabled plugins |
| `src/plugins/erp-bc/sync/sync-replay.routes.ts` | Create | Dead-letter replay REST routes |
| `src/plugins/erp-bc/sync/sync-jobs.routes.ts` | Create | Sync jobs CRUD routes |
| `src/plugins/erp-bc/index.ts` | Modify | Register new routes |
| `tests/integration/rate-limit.test.ts` | Create | Rate-limit integration test |
| `tests/integration/sync-replay.test.ts` | Create | Replay integration test |

---

### Task 1: OTel Metrics Infrastructure

**Files:**
- Create: `src/infra/observability/metrics.ts`
- Create: `src/infra/observability/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/observability/metrics.test.ts
import { describe, test, expect } from 'bun:test';
import { getMetrics } from '../../../src/infra/observability/metrics';

describe('metrics', () => {
  test('getMetrics returns meter with expected instruments', () => {
    const m = getMetrics();
    expect(m.taskCounter).toBeDefined();
    expect(m.taskDuration).toBeDefined();
    expect(m.pluginHealthGauge).toBeDefined();
    expect(m.syncRecordCounter).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/unit/observability/metrics.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Install OTel packages**

```bash
bun add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

- [ ] **Step 4: Create `src/infra/observability/metrics.ts`**

```typescript
import { metrics, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';

const METER_NAME = 'supplymind.backend';

export interface AppMetrics {
  taskCounter: Counter;
  taskDuration: Histogram;
  pluginHealthGauge: ObservableGauge;
  syncRecordCounter: Counter;
  intentGateLatency: Histogram;
  rateLimit: Counter;
}

let _metrics: AppMetrics | undefined;

export function getMetrics(): AppMetrics {
  if (_metrics) return _metrics;
  const meter = metrics.getMeter(METER_NAME, '1.0.0');

  _metrics = {
    taskCounter: meter.createCounter('task.created', {
      description: 'Number of tasks created',
    }),
    taskDuration: meter.createHistogram('task.duration_ms', {
      description: 'Task execution duration in milliseconds',
      unit: 'ms',
    }),
    pluginHealthGauge: meter.createObservableGauge('plugin.health', {
      description: '1 = healthy, 0 = unhealthy',
    }),
    syncRecordCounter: meter.createCounter('erp.sync_record', {
      description: 'ERP sync records processed',
    }),
    intentGateLatency: meter.createHistogram('intent_gate.latency_ms', {
      description: 'Intent-gate classification latency',
      unit: 'ms',
    }),
    rateLimit: meter.createCounter('rate_limit.rejected', {
      description: 'Requests rejected by rate limiter',
    }),
  };

  return _metrics;
}
```

- [ ] **Step 5: Create `src/infra/observability/index.ts`**

```typescript
export { getMetrics } from './metrics';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let sdk: NodeSDK | undefined;

export function initTelemetry(): void {
  if (sdk) return;
  sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
bun test tests/unit/observability/metrics.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/infra/observability/metrics.ts src/infra/observability/index.ts tests/unit/observability/metrics.test.ts
git commit -m "feat(observability): add OTel metrics instruments"
```

---

### Task 2: Per-Plugin Rate Limit Config

**Files:**
- Modify: `src/api/middlewares/rate-limit.ts`

- [ ] **Step 1: Read the current file**

```bash
cat src/api/middlewares/rate-limit.ts
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/middlewares/rate-limit.test.ts
import { describe, test, expect } from 'bun:test';
import { PLUGIN_RATE_LIMITS } from '../../../src/api/middlewares/rate-limit';

describe('PLUGIN_RATE_LIMITS', () => {
  test('exports a map with default entry', () => {
    expect(PLUGIN_RATE_LIMITS).toBeDefined();
    expect(PLUGIN_RATE_LIMITS.default).toBeDefined();
    expect(PLUGIN_RATE_LIMITS.default.windowMs).toBeGreaterThan(0);
    expect(PLUGIN_RATE_LIMITS.default.max).toBeGreaterThan(0);
  });

  test('erp-bc plugin has its own config', () => {
    expect(PLUGIN_RATE_LIMITS['erp-bc']).toBeDefined();
    expect(PLUGIN_RATE_LIMITS['erp-bc'].max).toBeLessThanOrEqual(
      PLUGIN_RATE_LIMITS.default.max,
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
bun test tests/unit/middlewares/rate-limit.test.ts
```
Expected: FAIL — PLUGIN_RATE_LIMITS not exported

- [ ] **Step 4: Add `PLUGIN_RATE_LIMITS` export to `src/api/middlewares/rate-limit.ts`**

Append after existing exports (do not remove existing middleware):

```typescript
export interface PluginRateLimitConfig {
  windowMs: number;
  max: number;
}

export const PLUGIN_RATE_LIMITS: Record<string, PluginRateLimitConfig> = {
  default: { windowMs: 60_000, max: 200 },
  'erp-bc': { windowMs: 60_000, max: 60 },
  'execution-layer': { windowMs: 60_000, max: 100 },
};

/**
 * Returns the rate limit config for a plugin, falling back to default.
 */
export function pluginRateLimit(pluginId: string): PluginRateLimitConfig {
  return PLUGIN_RATE_LIMITS[pluginId] ?? PLUGIN_RATE_LIMITS.default;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/unit/middlewares/rate-limit.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/api/middlewares/rate-limit.ts tests/unit/middlewares/rate-limit.test.ts
git commit -m "feat(rate-limit): export PLUGIN_RATE_LIMITS and pluginRateLimit helper"
```

---

### Task 3: Plugin Health Check BullMQ Worker

**Files:**
- Create: `src/infra/queue/workers/plugin-health.worker.ts`
- Modify: `src/app/bootstrap.ts` (register repeatable job)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/queue/plugin-health.worker.test.ts
import { describe, test, expect, mock } from 'bun:test';

const mockList = mock(async () => [
  { id: 'inst-1', pluginId: 'erp-bc', workspaceId: 'ws-1', status: 'enabled' },
]);
const mockRunHealthCheck = mock(async () => ({ ok: true, latencyMs: 42 }));

mock.module('../../../src/modules/plugins/plugins.repo', () => ({
  pluginInstallationRepo: { listEnabled: mockList },
}));
mock.module('../../../src/modules/plugins/plugins.service', () => ({
  pluginsService: { runHealthCheck: mockRunHealthCheck },
}));

import { processHealthCheckJob } from '../../../src/infra/queue/workers/plugin-health.worker';

describe('plugin-health worker', () => {
  test('processes health check for each enabled installation', async () => {
    await processHealthCheckJob();
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockRunHealthCheck).toHaveBeenCalledWith('inst-1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/unit/queue/plugin-health.worker.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/infra/queue/workers/plugin-health.worker.ts`**

```typescript
import { logger } from '../../../config/logger';
import { pluginInstallationRepo } from '../../../modules/plugins/plugins.repo';
import { pluginsService } from '../../../modules/plugins/plugins.service';
import { getMetrics } from '../../observability/metrics';

export async function processHealthCheckJob(): Promise<void> {
  const installations = await pluginInstallationRepo.listEnabled();
  const metrics = getMetrics();

  await Promise.allSettled(
    installations.map(async (inst) => {
      try {
        const result = await pluginsService.runHealthCheck(inst.id);
        const healthy = result.ok ? 1 : 0;
        metrics.pluginHealthGauge.addCallback((obs) => {
          obs.observe(healthy, {
            pluginId: inst.pluginId,
            workspaceId: inst.workspaceId,
          });
        });
        logger.debug({ instId: inst.id, healthy }, 'plugin health check');
      } catch (err) {
        logger.warn({ instId: inst.id, err }, 'plugin health check failed');
      }
    }),
  );
}
```

- [ ] **Step 4: Register repeatable job in `src/app/bootstrap.ts`**

Add inside the bootstrap function after existing queue registrations:

```typescript
// Plugin health check — runs every 5 minutes
const { Queue } = await import('bullmq');
const healthQueue = new Queue('plugin-health', { connection: redis });
await healthQueue.add(
  'health-check',
  {},
  {
    repeat: { every: 5 * 60 * 1000 },
    jobId: 'plugin-health-repeatable',
  },
);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/unit/queue/plugin-health.worker.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/infra/queue/workers/plugin-health.worker.ts src/app/bootstrap.ts tests/unit/queue/plugin-health.worker.test.ts
git commit -m "feat(plugins): add repeatable BullMQ health check worker"
```

---

### Task 4: Dead-Letter Replay Routes

**Files:**
- Create: `src/plugins/erp-bc/sync/sync-replay.routes.ts`
- Modify: `src/plugins/erp-bc/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sync/sync-replay.routes.test.ts
import { describe, test, expect, mock } from 'bun:test';
import { Hono } from 'hono';
import { syncReplayRoutes } from '../../../src/plugins/erp-bc/sync/sync-replay.routes';

const mockReplay = mock(async () => ({ replayed: 1, skipped: 0 }));
mock.module('../../../src/plugins/erp-bc/sync/sync.service', () => ({
  syncService: { replayDeadLetters: mockReplay },
}));

describe('sync-replay routes', () => {
  const app = new Hono();
  app.route('/sync', syncReplayRoutes);

  test('POST /sync/replay triggers replay', async () => {
    const res = await app.request('/sync/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replayed).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/unit/sync/sync-replay.routes.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/plugins/erp-bc/sync/sync-replay.routes.ts`**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { syncService } from './sync.service';

const replaySchema = z.object({
  workspaceId: z.string(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const syncReplayRoutes = new Hono();

syncReplayRoutes.post(
  '/replay',
  zValidator('json', replaySchema),
  async (c) => {
    const { workspaceId, limit } = c.req.valid('json');
    const result = await syncService.replayDeadLetters(workspaceId, limit);
    return c.json(result);
  },
);
```

- [ ] **Step 4: Register routes in `src/plugins/erp-bc/index.ts`**

```typescript
import { syncReplayRoutes } from './sync/sync-replay.routes';
// ... inside the plugin registration:
app.route('/plugins/erp-bc/sync', syncReplayRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/unit/sync/sync-replay.routes.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/erp-bc/sync/sync-replay.routes.ts src/plugins/erp-bc/index.ts tests/unit/sync/sync-replay.routes.test.ts
git commit -m "feat(erp-bc): add dead-letter replay route"
```

---

### Task 5: Sync Jobs CRUD Routes

**Files:**
- Create: `src/plugins/erp-bc/sync/sync-jobs.routes.ts`
- Modify: `src/plugins/erp-bc/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sync/sync-jobs.routes.test.ts
import { describe, test, expect, mock } from 'bun:test';
import { Hono } from 'hono';
import { syncJobsRoutes } from '../../../src/plugins/erp-bc/sync/sync-jobs.routes';

const fakeJob = { id: 'job-1', entity: 'vendor', status: 'pending', workspaceId: 'ws-1' };
const mockList = mock(async () => [fakeJob]);
const mockGet = mock(async (id: string) => (id === 'job-1' ? fakeJob : null));
const mockCreate = mock(async () => fakeJob);
const mockDelete = mock(async () => ({ deleted: true }));

mock.module('../../../src/plugins/erp-bc/sync/sync-jobs.repo', () => ({
  syncJobsRepo: {
    list: mockList,
    findById: mockGet,
    create: mockCreate,
    delete: mockDelete,
  },
}));

describe('sync-jobs routes', () => {
  const app = new Hono();
  app.route('/sync-jobs', syncJobsRoutes);

  test('GET /sync-jobs returns list', async () => {
    const res = await app.request('/sync-jobs?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe('job-1');
  });

  test('GET /sync-jobs/:id returns job', async () => {
    const res = await app.request('/sync-jobs/job-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('job-1');
  });

  test('GET /sync-jobs/:id returns 404 for missing', async () => {
    const res = await app.request('/sync-jobs/missing');
    expect(res.status).toBe(404);
  });

  test('POST /sync-jobs creates job', async () => {
    const res = await app.request('/sync-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', entity: 'vendor' }),
    });
    expect(res.status).toBe(201);
  });

  test('DELETE /sync-jobs/:id deletes job', async () => {
    const res = await app.request('/sync-jobs/job-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/unit/sync/sync-jobs.routes.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/plugins/erp-bc/sync/sync-jobs.routes.ts`**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { syncJobsRepo } from './sync-jobs.repo';

const createSchema = z.object({
  workspaceId: z.string(),
  entity: z.string(),
  schedule: z.string().optional(),
});

export const syncJobsRoutes = new Hono();

syncJobsRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  const jobs = await syncJobsRepo.list(workspaceId);
  return c.json(jobs);
});

syncJobsRoutes.get('/:id', async (c) => {
  const job = await syncJobsRepo.findById(c.req.param('id'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(job);
});

syncJobsRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json');
  const job = await syncJobsRepo.create(data);
  return c.json(job, 201);
});

syncJobsRoutes.delete('/:id', async (c) => {
  const result = await syncJobsRepo.delete(c.req.param('id'));
  return c.json(result);
});
```

- [ ] **Step 4: Register routes in `src/plugins/erp-bc/index.ts`**

```typescript
import { syncJobsRoutes } from './sync/sync-jobs.routes';
// inside plugin registration:
app.route('/plugins/erp-bc/sync-jobs', syncJobsRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/unit/sync/sync-jobs.routes.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/erp-bc/sync/sync-jobs.routes.ts src/plugins/erp-bc/index.ts tests/unit/sync/sync-jobs.routes.test.ts
git commit -m "feat(erp-bc): add sync-jobs CRUD routes"
```

---

### Task 6: Integration Tests — Rate Limits & Replay

**Files:**
- Create: `tests/integration/rate-limit.test.ts`
- Create: `tests/integration/sync-replay.test.ts`

- [ ] **Step 1: Create `tests/integration/rate-limit.test.ts`**

```typescript
import { describe, test, expect, beforeAll } from 'bun:test';
import { createTestApp } from './helpers/app';
import type { App } from '../../src/app/create-app';

let app: App;

beforeAll(async () => {
  app = await createTestApp();
});

describe('rate limit middleware', () => {
  test('PLUGIN_RATE_LIMITS default config has sensible values', async () => {
    const { PLUGIN_RATE_LIMITS } = await import('../../src/api/middlewares/rate-limit');
    expect(PLUGIN_RATE_LIMITS.default.max).toBeGreaterThanOrEqual(100);
    expect(PLUGIN_RATE_LIMITS.default.windowMs).toBeGreaterThanOrEqual(60_000);
  });

  test('erp-bc rate limit is lower than or equal to default', async () => {
    const { PLUGIN_RATE_LIMITS } = await import('../../src/api/middlewares/rate-limit');
    expect(PLUGIN_RATE_LIMITS['erp-bc'].max).toBeLessThanOrEqual(
      PLUGIN_RATE_LIMITS.default.max,
    );
  });
});
```

- [ ] **Step 2: Create `tests/integration/sync-replay.test.ts`**

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDb, cleanTestDb } from './helpers/db';
import type { TestDb } from './helpers/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await cleanTestDb(db);
});

describe('sync replay', () => {
  test('replayDeadLetters returns zero counts when no dead letters exist', async () => {
    // Dynamically import to respect mock setup in unit tests; here we test DB contract
    const { syncService } = await import('../../src/plugins/erp-bc/sync/sync.service');
    // syncService.replayDeadLetters is a no-op when no failed records exist
    // This test verifies the DB query runs without error
    const result = await syncService.replayDeadLetters('ws-no-records', 10);
    expect(result).toBeDefined();
    expect(typeof result.replayed).toBe('number');
    expect(typeof result.skipped).toBe('number');
  });
});
```

- [ ] **Step 3: Run integration tests**

```bash
bun test tests/integration/rate-limit.test.ts tests/integration/sync-replay.test.ts
```
Expected: PASS (or SKIP gracefully if ERP BC plugin not installed)

- [ ] **Step 4: Commit**

```bash
git add tests/integration/rate-limit.test.ts tests/integration/sync-replay.test.ts
git commit -m "test(integration): add rate-limit and sync-replay integration tests"
```

---

### Task 7: Wire OTel Init in Bootstrap

**Files:**
- Modify: `src/app/bootstrap.ts`

- [ ] **Step 1: Add `initTelemetry()` call at the top of bootstrap**

```typescript
import { initTelemetry, shutdownTelemetry } from '../infra/observability';

// At the very start of the bootstrap function, before anything else:
initTelemetry();
```

- [ ] **Step 2: Add `shutdownTelemetry()` to graceful shutdown**

```typescript
// In the graceful shutdown handler:
process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
```

- [ ] **Step 3: Run all tests to make sure nothing regressed**

```bash
bun test
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/app/bootstrap.ts
git commit -m "feat(observability): initialize OTel SDK on startup, shutdown on SIGTERM"
```

---

### Task 8: Final Wiring Check

- [ ] **Step 1: Run the full test suite**

```bash
bun test --reporter=verbose 2>&1 | tail -20
```
Expected: all suites pass, 0 failures

- [ ] **Step 2: Build check**

```bash
bun run build
```
Expected: exit 0, no TypeScript errors

- [ ] **Step 3: Commit all remaining changes**

```bash
git add -A
git status
git commit -m "chore(production-hardening): final wiring and cleanup"
```

---

## Self-Review

**Spec coverage:**
- OTel metrics instruments — Task 1 ✓
- Per-plugin rate limit config exported — Task 2 ✓
- Plugin health check repeatable worker — Task 3 ✓
- Dead-letter replay route — Task 4 ✓
- Sync jobs CRUD — Task 5 ✓
- Integration tests — Task 6 ✓
- OTel init wired in bootstrap — Task 7 ✓

**Placeholder scan:** None found — all steps have concrete code.

**Type consistency:** `PluginRateLimitConfig` used in Task 2 and referenced consistently. `getMetrics()` return type `AppMetrics` is stable across Tasks 1, 3, 7.
