# Health, Security & Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend production-ready with health probes, security hardening, Novu notifications, Bun-compatible OTel tracing, cleanup/sync background jobs, and bootstrap fixes.

**Architecture:** Seven independent infrastructure tasks. Each modifies a small set of files with clear boundaries. No new domain logic — all changes wire existing patterns (BullMQ jobs, Hono middleware, EventBus) to fill infrastructure gaps.

**Tech Stack:** Hono (secureHeaders, cors), @novu/api v3, @opentelemetry/sdk-trace-base + exporter-trace-otlp-http, BullMQ repeatable jobs (upsertJobScheduler), Drizzle raw SQL, ioredis.

---

## File Structure

| File | Responsibility | Task |
|------|---------------|------|
| `src/infra/db/client.ts` | Add `closeDb()` export | 1 |
| `src/infra/redis/client.ts` | Add shared singleton + `closeSharedRedisClient()` | 1 |
| `src/modules/health/health.service.ts` | DB + Redis health checks | 1 |
| `src/modules/health/__tests__/health.test.ts` | Health service tests | 1 |
| `src/app/create-app.ts` | `/readyz` route, CORS config, secureHeaders | 1, 2 |
| `src/config/env.ts` | Add `CORS_ALLOWED_ORIGINS` | 2 |
| `src/api/middlewares/__tests__/security.test.ts` | CORS + headers tests | 2 |
| `src/infra/notifications/novu.ts` | Novu v3 provider | 3 |
| `src/infra/notifications/__tests__/novu.test.ts` | Novu tests | 3 |
| `src/infra/observability/otel.ts` | `initOtel()` + `shutdownOtel()` | 4 |
| `src/infra/observability/__tests__/otel.test.ts` | OTel tests | 4 |
| `src/infra/a2a/task-repo.ts` | Add `findStale()` | 5 |
| `src/modules/api-keys/api-keys.repo.ts` | Add `deleteExpired()` | 5 |
| `src/infra/queue/bullmq.ts` | Add `cleanupQueue`, `syncQueue` | 5, 6 |
| `src/jobs/cleanup/index.ts` | Cleanup job worker | 5 |
| `src/jobs/cleanup/__tests__/cleanup.test.ts` | Cleanup job tests | 5 |
| `src/jobs/sync/index.ts` | Agent registry sync worker | 6 |
| `src/jobs/sync/__tests__/sync.test.ts` | Sync job tests | 6 |
| `src/modules/agent-registry/agent-registry.service.ts` | Add `refreshAll()` | 6 |
| `src/app/bootstrap.ts` | Fix dup workers, wire OTel, wire jobs, shared Redis, DB shutdown | 7 |
| `src/modules/skills/providers/builtin.provider.ts` | Set `input_required` status during pause | 7 |
| `package.json` | Remove `@novu/node`, swap OTel deps | 4 |

---

### Task 1: Health Probes — DB + Redis checks, `/readyz` endpoint

**Files:**
- Modify: `src/infra/db/client.ts`
- Modify: `src/infra/redis/client.ts`
- Modify: `src/modules/health/health.service.ts`
- Modify: `src/app/create-app.ts`
- Create: `src/modules/health/__tests__/health.test.ts`

- [ ] **Step 1: Write the health service test**

```typescript
// src/modules/health/__tests__/health.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock db
const mockExecute = mock(() => Promise.resolve([{ '?column?': 1 }]));
mock.module('../../../infra/db/client', () => ({
  db: { execute: mockExecute },
}));

// Mock redis
const mockPing = mock(() => Promise.resolve('PONG'));
mock.module('../../../infra/redis/client', () => ({
  getSharedRedisClient: () => ({ ping: mockPing }),
}));

const { healthService } = await import('../health.service');

describe('healthService', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockReset();
    mockPing.mockResolvedValue('PONG');
  });

  it('returns ready when all checks pass', async () => {
    const result = await healthService.readiness();
    expect(result.status).toBe('ready');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.redis).toBe('ok');
  });

  it('returns degraded when DB fails', async () => {
    mockExecute.mockRejectedValue(new Error('connection refused'));
    const result = await healthService.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe('error');
    expect(result.checks.redis).toBe('ok');
  });

  it('returns degraded when Redis fails', async () => {
    mockPing.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await healthService.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.redis).toBe('error');
  });

  it('returns degraded when both fail', async () => {
    mockExecute.mockRejectedValue(new Error('db down'));
    mockPing.mockRejectedValue(new Error('redis down'));
    const result = await healthService.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe('error');
    expect(result.checks.redis).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/health/__tests__/health.test.ts`
Expected: FAIL — `healthService` has no `readiness` method (stub class)

- [ ] **Step 3: Add `closeDb()` to db client**

```typescript
// src/infra/db/client.ts — full file after edit
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = Bun.env.DATABASE_URL!;
const client = postgres(connectionString);
export const db = drizzle(client);

export async function closeDb(): Promise<void> {
  await client.end();
}
```

- [ ] **Step 4: Add shared Redis singleton to redis client**

```typescript
// src/infra/redis/client.ts — append after existing createRedisPair function
let sharedClient: Redis | null = null;

export function getSharedRedisClient(): Redis {
  if (!sharedClient) {
    const url = Bun.env.REDIS_URL ?? 'redis://localhost:6379';
    sharedClient = new Redis(url);
  }
  return sharedClient;
}

export async function closeSharedRedisClient(): Promise<void> {
  if (sharedClient) {
    await sharedClient.quit();
    sharedClient = null;
  }
}
```

- [ ] **Step 5: Implement health service**

```typescript
// src/modules/health/health.service.ts — full file replacement
import { db } from '../../infra/db/client';
import { getSharedRedisClient } from '../../infra/redis/client';
import { sql } from 'drizzle-orm';

type CheckStatus = 'ok' | 'error';

interface ReadinessResult {
  status: 'ready' | 'degraded';
  checks: { db: CheckStatus; redis: CheckStatus };
}

async function checkDb(): Promise<CheckStatus> {
  try {
    await db.execute(sql`SELECT 1`);
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRedis(): Promise<CheckStatus> {
  try {
    await getSharedRedisClient().ping();
    return 'ok';
  } catch {
    return 'error';
  }
}

export const healthService = {
  async readiness(): Promise<ReadinessResult> {
    const [dbStatus, redisStatus] = await Promise.all([checkDb(), checkRedis()]);
    const allOk = dbStatus === 'ok' && redisStatus === 'ok';
    return {
      status: allOk ? 'ready' : 'degraded',
      checks: { db: dbStatus, redis: redisStatus },
    };
  },
};
```

- [ ] **Step 6: Add `/readyz` route to create-app.ts**

In `src/app/create-app.ts`, after the existing `/healthz` route (around line 34), add:

```typescript
import { healthService } from '../modules/health/health.service';

// ... inside createApp(), after the /healthz route:
app.get('/readyz', async (c) => {
  const result = await healthService.readiness();
  return c.json(result, result.status === 'ready' ? 200 : 503);
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test src/modules/health/__tests__/health.test.ts`
Expected: 4 tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/infra/db/client.ts src/infra/redis/client.ts src/modules/health/health.service.ts src/modules/health/__tests__/health.test.ts src/app/create-app.ts
git commit -m "feat: add /readyz health probe with DB + Redis checks"
```

---

### Task 2: Security — CORS configuration + secure headers

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/app/create-app.ts`
- Create: `src/api/middlewares/__tests__/security.test.ts`

- [ ] **Step 1: Write the security tests**

```typescript
// src/api/middlewares/__tests__/security.test.ts
import { describe, it, expect } from 'bun:test';

describe('security headers and CORS', () => {
  it('sets security headers on responses', async () => {
    // Import the app — this will use whatever CORS config is set
    const { createApp } = await import('../../../app/create-app');
    const app = await createApp();

    const res = await app.request('/healthz');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('includes HSTS header', async () => {
    const { createApp } = await import('../../../app/create-app');
    const app = await createApp();

    const res = await app.request('/healthz');
    const hsts = res.headers.get('Strict-Transport-Security');
    expect(hsts).toContain('max-age=');
  });

  it('does not set Content-Security-Policy (JSON API)', async () => {
    const { createApp } = await import('../../../app/create-app');
    const app = await createApp();

    const res = await app.request('/healthz');
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/middlewares/__tests__/security.test.ts`
Expected: FAIL — no `X-Content-Type-Options` header present

- [ ] **Step 3: Add `CORS_ALLOWED_ORIGINS` to env schema**

In `src/config/env.ts`, add inside the `z.object({...})` block, after `OTEL_SERVICE_NAME`:

```typescript
CORS_ALLOWED_ORIGINS: z.string().optional(),
```

- [ ] **Step 4: Add secureHeaders and configure CORS in create-app.ts**

In `src/app/create-app.ts`, add imports at the top:

```typescript
import { secureHeaders } from 'hono/secure-headers';
```

Replace the existing `app.use('*', cors())` line (line 27) with:

```typescript
// Security headers — all routes
app.use('*', secureHeaders({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  xFrameOptions: 'DENY',
  strictTransportSecurity: 'max-age=63072000; includeSubDomains',
  referrerPolicy: 'strict-origin-when-cross-origin',
}));

// CORS — permissive for public routes (A2A, MCP), restrictive for API
const allowedOrigins = Bun.env.CORS_ALLOWED_ORIGINS
  ? Bun.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin;                      // non-browser request
    if (allowedOrigins.includes('*')) return origin;  // wildcard override
    return allowedOrigins.includes(origin) ? origin : null;
  },
  credentials: true,
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/api/middlewares/__tests__/security.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts src/app/create-app.ts src/api/middlewares/__tests__/security.test.ts
git commit -m "feat: add secureHeaders middleware and env-configurable CORS"
```

---

### Task 3: Novu notification provider

**Files:**
- Modify: `src/infra/notifications/novu.ts`
- Create: `src/infra/notifications/__tests__/novu.test.ts`

- [ ] **Step 1: Write the Novu provider test**

```typescript
// src/infra/notifications/__tests__/novu.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockTrigger = mock(() => Promise.resolve({ acknowledged: true }));
mock.module('@novu/api', () => ({
  Novu: class {
    constructor() {}
    trigger = mockTrigger;
  },
}));

// Set env before importing
process.env.NOVU_API_KEY = 'test-key-123';

const { triggerNotification, getNovuClient, NovuWorkflows } = await import('../novu');

describe('Novu provider', () => {
  beforeEach(() => {
    mockTrigger.mockReset();
    mockTrigger.mockResolvedValue({ acknowledged: true });
  });

  it('returns a client when API key is set', () => {
    const client = getNovuClient();
    expect(client).not.toBeNull();
  });

  it('triggers a notification with correct params', async () => {
    await triggerNotification('agent-failure', 'user-1', { agentId: 'a-1' });
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    const call = mockTrigger.mock.calls[0][0];
    expect(call.name).toBe('agent-failure');
    expect(call.to.subscriberId).toBe('user-1');
    expect(call.payload.agentId).toBe('a-1');
  });

  it('exports workflow ID constants', () => {
    expect(NovuWorkflows.AGENT_FAILURE).toBe('agent-failure');
    expect(NovuWorkflows.TASK_COMPLETED).toBe('task-completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/infra/notifications/__tests__/novu.test.ts`
Expected: FAIL — `triggerNotification` is not exported from stub

- [ ] **Step 3: Implement Novu provider**

```typescript
// src/infra/notifications/novu.ts — full file replacement
import { Novu } from '@novu/api';
import { logger } from '../../config/logger';

let client: Novu | null = null;

export function getNovuClient(): Novu | null {
  const apiKey = Bun.env.NOVU_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Novu({ secretKey: apiKey });
  return client;
}

export async function triggerNotification(
  workflowId: string,
  subscriberId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const novu = getNovuClient();
  if (!novu) {
    logger.warn({ workflowId }, 'Novu not configured — skipping notification');
    return;
  }
  try {
    await novu.trigger({ name: workflowId, to: { subscriberId }, payload });
  } catch (err) {
    logger.error({ workflowId, subscriberId, err }, 'Novu trigger failed');
  }
}

export const NovuWorkflows = {
  AGENT_FAILURE: 'agent-failure',
  TASK_COMPLETED: 'task-completed',
  API_KEY_CREATED: 'api-key-created',
  WORKSPACE_INVITATION: 'workspace-invitation',
} as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/infra/notifications/__tests__/novu.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Remove `@novu/node` from package.json**

```bash
bun remove @novu/node
```

- [ ] **Step 6: Delete the duplicate stub**

Delete `src/modules/notifications/channels/in-app/novu.provider.ts` if it exists, or replace its contents with a re-export:

```typescript
// src/modules/notifications/channels/in-app/novu.provider.ts
export { triggerNotification, getNovuClient, NovuWorkflows } from '../../../../infra/notifications/novu';
```

- [ ] **Step 7: Commit**

```bash
git add src/infra/notifications/novu.ts src/infra/notifications/__tests__/novu.test.ts src/modules/notifications/channels/in-app/novu.provider.ts package.json bun.lock
git commit -m "feat: wire Novu v3 notification provider, remove legacy @novu/node"
```

---

### Task 4: OTel — Bun-compatible tracing init

**Files:**
- Modify: `src/infra/observability/otel.ts`
- Modify: `package.json` (swap OTel deps)
- Create: `src/infra/observability/__tests__/otel.test.ts`

- [ ] **Step 1: Swap OTel dependencies**

```bash
bun remove @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
bun add @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
```

- [ ] **Step 2: Write the OTel test**

```typescript
// src/infra/observability/__tests__/otel.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

describe('OTel initialization', () => {
  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it('no-ops when OTEL_EXPORTER_OTLP_ENDPOINT is not set', async () => {
    const { initOtel, shutdownOtel } = await import('../otel');
    // Should not throw
    initOtel();
    await shutdownOtel();
  });

  it('withSpan still works without initialization', async () => {
    const { withSpan } = await import('../otel');
    const result = await withSpan('test-span', {}, async () => 42);
    expect(result).toBe(42);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/infra/observability/__tests__/otel.test.ts`
Expected: FAIL — `initOtel` is not exported

- [ ] **Step 4: Extend otel.ts with initOtel and shutdownOtel**

```typescript
// src/infra/observability/otel.ts — full file replacement
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { logger } from '../../config/logger';

const tracer = trace.getTracer('supplymind-backend');

let provider: import('@opentelemetry/sdk-trace-base').BasicTracerProvider | null = null;

export function initOtel(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.info('OTel: no OTEL_EXPORTER_OTLP_ENDPOINT — traces disabled');
    return;
  }

  try {
    // Dynamic imports to avoid loading heavy deps when OTel is disabled
    const { BasicTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'supplymind-backend';
    const resource = new Resource({ [ATTR_SERVICE_NAME]: serviceName });
    const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

    provider = new BasicTracerProvider({ resource });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider.register();

    logger.info({ endpoint, serviceName }, 'OTel: tracing initialized');
  } catch (err) {
    logger.warn({ err }, 'OTel: failed to initialize — traces disabled');
  }
}

export async function shutdownOtel(): Promise<void> {
  if (provider) {
    await provider.shutdown();
    provider = null;
  }
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

export { tracer, SpanStatusCode };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/infra/observability/__tests__/otel.test.ts`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/infra/observability/otel.ts src/infra/observability/__tests__/otel.test.ts package.json bun.lock
git commit -m "feat: Bun-compatible OTel tracing with BasicTracerProvider"
```

---

### Task 5: Cleanup job — stale tasks, expired sessions/keys, dead letters

**Files:**
- Modify: `src/infra/a2a/task-repo.ts`
- Modify: `src/modules/api-keys/api-keys.repo.ts`
- Modify: `src/infra/queue/bullmq.ts`
- Modify: `src/jobs/cleanup/index.ts`
- Create: `src/jobs/cleanup/__tests__/cleanup.test.ts`

- [ ] **Step 1: Write the cleanup job test**

```typescript
// src/jobs/cleanup/__tests__/cleanup.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFindStale = mock(() => Promise.resolve([]));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockExpireSessions = mock(() => Promise.resolve(0));
const mockDeleteExpiredKeys = mock(() => Promise.resolve(0));

mock.module('../../../infra/a2a/task-repo', () => ({
  taskRepo: { findStale: mockFindStale, updateStatus: mockUpdateStatus },
}));
mock.module('../../../modules/sessions/sessions.service', () => ({
  sessionsService: { expireIdleSessions: mockExpireSessions },
}));
mock.module('../../../modules/api-keys/api-keys.repo', () => ({
  apiKeysRepo: { deleteExpired: mockDeleteExpiredKeys },
}));
mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { runCleanup } = await import('../index');

describe('cleanup job', () => {
  beforeEach(() => {
    mockFindStale.mockReset();
    mockFindStale.mockResolvedValue([]);
    mockUpdateStatus.mockReset();
    mockExpireSessions.mockReset();
    mockExpireSessions.mockResolvedValue(0);
    mockDeleteExpiredKeys.mockReset();
    mockDeleteExpiredKeys.mockResolvedValue(0);
  });

  it('calls all cleanup steps', async () => {
    await runCleanup();
    // findStale called for both 'working' and 'submitted'
    expect(mockFindStale).toHaveBeenCalledTimes(2);
    expect(mockExpireSessions).toHaveBeenCalledTimes(1);
    expect(mockDeleteExpiredKeys).toHaveBeenCalledTimes(1);
  });

  it('marks stale working tasks as failed', async () => {
    mockFindStale.mockResolvedValueOnce([
      { id: 't-1', status: { state: 'working' } },
    ]);
    await runCleanup();
    expect(mockUpdateStatus).toHaveBeenCalledWith('t-1', 'failed', undefined, undefined);
  });

  it('continues if one step fails', async () => {
    mockFindStale.mockRejectedValueOnce(new Error('db error'));
    // Should not throw — other steps still run
    await runCleanup();
    expect(mockExpireSessions).toHaveBeenCalledTimes(1);
    expect(mockDeleteExpiredKeys).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/jobs/cleanup/__tests__/cleanup.test.ts`
Expected: FAIL — `runCleanup` is not exported

- [ ] **Step 3: Add `findStale` to task-repo**

In `src/infra/a2a/task-repo.ts`, add after the existing `findByStatus` method (around line 93):

```typescript
async findStale(status: TaskState, olderThanMs: number): Promise<A2ATask[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db.select().from(a2aTasks)
    .where(and(eq(a2aTasks.status, status), lt(a2aTasks.updatedAt, cutoff)));
  return rows.map(mapRowToTask);
},
```

You will need to add `and`, `lt` to the existing drizzle-orm imports at the top of the file:

```typescript
import { eq, and, lt } from 'drizzle-orm';
```

- [ ] **Step 4: Add `deleteExpired` to api-keys repo**

In `src/modules/api-keys/api-keys.repo.ts`, add a new method:

```typescript
async deleteExpired(): Promise<number> {
  const result = await db.delete(apiKeys)
    .where(and(isNotNull(apiKeys.expiresAt), lt(apiKeys.expiresAt, new Date())));
  return result.length;
},
```

Add `and`, `lt`, `isNotNull` to the drizzle-orm imports.

- [ ] **Step 5: Add `cleanupQueue` to bullmq.ts**

In `src/infra/queue/bullmq.ts`, add after the existing queue definitions:

```typescript
export const cleanupQueue = new Queue('cleanup', { connection });
```

- [ ] **Step 6: Implement the cleanup job**

```typescript
// src/jobs/cleanup/index.ts — full file replacement
import { taskRepo } from '../../infra/a2a/task-repo';
import { sessionsService } from '../../modules/sessions/sessions.service';
import { apiKeysRepo } from '../../modules/api-keys/api-keys.repo';
import { logger } from '../../config/logger';

const STALE_WORKING_MS = 30 * 60 * 1000;   // 30 minutes
const STALE_SUBMITTED_MS = 60 * 60 * 1000; // 60 minutes

export async function runCleanup(): Promise<void> {
  // 1. Stale working tasks
  try {
    const staleTasks = await taskRepo.findStale('working', STALE_WORKING_MS);
    for (const task of staleTasks) {
      await taskRepo.updateStatus(task.id, 'failed', undefined, undefined);
      logger.info({ taskId: task.id }, 'Cleanup: marked stale working task as failed');
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: stale working tasks step failed');
  }

  // 2. Stale submitted tasks
  try {
    const staleSubmitted = await taskRepo.findStale('submitted', STALE_SUBMITTED_MS);
    for (const task of staleSubmitted) {
      await taskRepo.updateStatus(task.id, 'failed', undefined, undefined);
      logger.info({ taskId: task.id }, 'Cleanup: marked stale submitted task as failed');
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: stale submitted tasks step failed');
  }

  // 3. Expired sessions
  try {
    const expired = await sessionsService.expireIdleSessions();
    if (expired > 0) logger.info({ count: expired }, 'Cleanup: expired idle sessions');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expire sessions step failed');
  }

  // 4. Expired API keys
  try {
    const deleted = await apiKeysRepo.deleteExpired();
    if (deleted > 0) logger.info({ count: deleted }, 'Cleanup: deleted expired API keys');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expired API keys step failed');
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test src/jobs/cleanup/__tests__/cleanup.test.ts`
Expected: 3 tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/infra/a2a/task-repo.ts src/modules/api-keys/api-keys.repo.ts src/infra/queue/bullmq.ts src/jobs/cleanup/index.ts src/jobs/cleanup/__tests__/cleanup.test.ts
git commit -m "feat: add cleanup job — stale tasks, expired sessions, expired API keys"
```

---

### Task 6: Sync job — agent registry refresh

**Files:**
- Modify: `src/modules/agent-registry/agent-registry.service.ts`
- Modify: `src/infra/queue/bullmq.ts`
- Modify: `src/jobs/sync/index.ts`
- Create: `src/jobs/sync/__tests__/sync.test.ts`

- [ ] **Step 1: Write the sync job test**

```typescript
// src/jobs/sync/__tests__/sync.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRefreshAll = mock(() => Promise.resolve({ refreshed: 2, failed: 0 }));
mock.module('../../../modules/agent-registry/agent-registry.service', () => ({
  agentRegistryService: { refreshAll: mockRefreshAll },
}));
mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { runSync } = await import('../index');

describe('sync job', () => {
  beforeEach(() => {
    mockRefreshAll.mockReset();
    mockRefreshAll.mockResolvedValue({ refreshed: 2, failed: 0 });
  });

  it('calls agentRegistryService.refreshAll', async () => {
    await runSync();
    expect(mockRefreshAll).toHaveBeenCalledTimes(1);
  });

  it('does not throw when refreshAll fails', async () => {
    mockRefreshAll.mockRejectedValue(new Error('network error'));
    await expect(runSync()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/jobs/sync/__tests__/sync.test.ts`
Expected: FAIL — `runSync` is not exported

- [ ] **Step 3: Add `refreshAll` to agent-registry service**

In `src/modules/agent-registry/agent-registry.service.ts`, add a new method inside the `AgentRegistryService` class (after the `refresh` method, around line 101):

```typescript
async refreshAll(): Promise<{ refreshed: number; failed: number }> {
  const agents = await agentRegistryRepo.findAll();
  let refreshed = 0;
  let failed = 0;
  for (const agent of agents) {
    try {
      await this.refresh(agent.workspaceId, agent.id);
      refreshed++;
    } catch (err) {
      logger.warn({ agentId: agent.id, err }, 'Agent refresh failed during sync');
      failed++;
    }
  }
  return { refreshed, failed };
}
```

- [ ] **Step 4: Add `syncQueue` to bullmq.ts**

In `src/infra/queue/bullmq.ts`, add after `cleanupQueue`:

```typescript
export const syncQueue = new Queue('sync', { connection });
```

- [ ] **Step 5: Implement the sync job**

```typescript
// src/jobs/sync/index.ts — full file replacement
import { agentRegistryService } from '../../modules/agent-registry/agent-registry.service';
import { logger } from '../../config/logger';

export async function runSync(): Promise<void> {
  try {
    const result = await agentRegistryService.refreshAll();
    logger.info(result, 'Sync: agent registry refresh complete');
  } catch (err) {
    logger.error({ err }, 'Sync: agent registry refresh failed');
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/jobs/sync/__tests__/sync.test.ts`
Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/agent-registry/agent-registry.service.ts src/infra/queue/bullmq.ts src/jobs/sync/index.ts src/jobs/sync/__tests__/sync.test.ts
git commit -m "feat: add agent registry sync job with refreshAll"
```

---

### Task 7: Bootstrap fixes — dedup workers, wire OTel/jobs, shared Redis, DB shutdown, input_required status

**Files:**
- Modify: `src/app/bootstrap.ts`
- Modify: `src/modules/skills/providers/builtin.provider.ts`

- [ ] **Step 1: Fix duplicate `startOrchestrationWorkers()` in bootstrap.ts**

In `src/app/bootstrap.ts`, delete the second `startOrchestrationWorkers()` call block (lines 152-159 approximately). The block looks like:

```typescript
// Step 11: ...
try {
  const { startOrchestrationWorkers } = await import('../jobs/orchestrations');
  startOrchestrationWorkers();
  logger.info('Step 11: Orchestration workers started');
} catch (err) {
  logger.warn({ err }, 'Step 11: Orchestration workers failed to start');
}
```

Keep the first occurrence (lines 143-150), delete the second one entirely.

- [ ] **Step 2: Wire `initOtel()` in bootstrap**

At the beginning of the `initSubsystems()` function (before Step 1), add:

```typescript
// Step 0: Initialize OTel tracing
const { initOtel } = await import('../infra/observability/otel');
initOtel();
```

- [ ] **Step 3: Wire job schedulers in bootstrap**

After the agent/orchestration worker startup section, add:

```typescript
// Step 12: Register repeatable job schedulers
try {
  const { cleanupQueue, syncQueue } = await import('../infra/queue/bullmq');
  const { Worker } = await import('bullmq');
  const { runCleanup } = await import('../jobs/cleanup');
  const { runSync } = await import('../jobs/sync');
  const Redis = (await import('ioredis')).default;

  const jobConnection = new Redis(Bun.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

  // Register cleanup scheduler — every 15 minutes
  await cleanupQueue.upsertJobScheduler('cleanup-sweep', { pattern: '*/15 * * * *' }, { name: 'cleanup' });
  new Worker('cleanup', async () => { await runCleanup(); }, { connection: jobConnection });

  // Register sync scheduler — every hour
  await syncQueue.upsertJobScheduler('agent-registry-sync', { pattern: '0 * * * *' }, { name: 'agent-sync' });
  new Worker('sync', async () => { await runSync(); }, { connection: jobConnection });

  logger.info('Step 12: Cleanup and sync job schedulers registered');
} catch (err) {
  logger.warn({ err }, 'Step 12: Job schedulers failed to register');
}
```

- [ ] **Step 4: Use shared Redis client in bootstrap**

In bootstrap's cache/pubsub wiring section (around lines 38-88), replace the ad-hoc Redis client creation:

Replace:
```typescript
const cacheClient = createRedisClient(Bun.env.REDIS_URL ?? 'redis://localhost:6379');
```

With:
```typescript
const { getSharedRedisClient } = await import('../infra/redis/client');
const cacheClient = getSharedRedisClient();
```

- [ ] **Step 5: Wire DB + Redis shutdown in destroySubsystems**

In `destroySubsystems()`, add at the end:

```typescript
// Close shared Redis
const { closeSharedRedisClient } = await import('../infra/redis/client');
await closeSharedRedisClient();

// Close DB connection pool
const { closeDb } = await import('../infra/db/client');
await closeDb();

// Shutdown OTel
const { shutdownOtel } = await import('../infra/observability/otel');
await shutdownOtel();
```

- [ ] **Step 6: Fix `request_user_input` — set task status to `input_required`**

In `src/modules/skills/providers/builtin.provider.ts`, in the `request_user_input` handler (around line 55), add before the `createInputRequest` call:

```typescript
// Set task status to input_required so UI reflects the pause
const { taskRepo } = await import('../../../infra/a2a/task-repo');
await taskRepo.updateStatus(taskId, 'input_required');
```

And after the `createInputRequest` resolves successfully (before returning `ok(input)`), restore the status:

```typescript
await taskRepo.updateStatus(taskId, 'working');
```

- [ ] **Step 7: Run full test suite**

Run: `bun test src/modules/health/__tests__/health.test.ts src/api/middlewares/__tests__/security.test.ts src/infra/notifications/__tests__/novu.test.ts src/infra/observability/__tests__/otel.test.ts src/jobs/cleanup/__tests__/cleanup.test.ts src/jobs/sync/__tests__/sync.test.ts`
Expected: All tests PASS (14+ tests)

- [ ] **Step 8: Commit**

```bash
git add src/app/bootstrap.ts src/modules/skills/providers/builtin.provider.ts
git commit -m "fix: dedup orchestration workers, wire OTel/jobs/shutdown, set input_required status"
```

---

## Verification

After all tasks:

1. `bun run test:run` — all existing + new tests pass
2. New test coverage:
   - `health.test.ts` — 4 tests (ready, db-fail, redis-fail, both-fail)
   - `security.test.ts` — 3 tests (headers present, HSTS, no CSP)
   - `novu.test.ts` — 3 tests (client init, trigger params, workflow constants)
   - `otel.test.ts` — 2 tests (no-op without env, withSpan works)
   - `cleanup.test.ts` — 3 tests (all steps called, stale task marked, step failure isolation)
   - `sync.test.ts` — 2 tests (refreshAll called, failure tolerance)
3. Manual: `curl localhost:3001/readyz` returns `{ status: 'ready', checks: { db: 'ok', redis: 'ok' } }`
4. Manual: `curl -I localhost:3001/healthz` shows `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
