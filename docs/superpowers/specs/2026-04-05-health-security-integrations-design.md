# Health, Security Hardening & Integration Layer

**Goal:** Make the backend production-ready by implementing health probes, security headers, CORS configuration, Novu notifications, OTel tracing (Bun-compatible), cleanup/sync background jobs, and fixing bootstrap bugs.

**Architecture:** All changes are independent infrastructure modules that wire into the existing Hono app and BullMQ job system. No new domain logic. Each section is self-contained and testable in isolation.

**Tech Stack:** Hono (secureHeaders, cors), @novu/api v3, @opentelemetry/sdk-trace-base + exporter-trace-otlp-http, BullMQ repeatable jobs, Drizzle (raw SQL for health checks).

---

## 1. Health Probes

### Requirements

Two endpoints:

- **`GET /healthz`** (liveness) — always returns `{ status: 'ok', timestamp }` with 200. No dependency checks. Already exists inline in `create-app.ts`; keep as-is, just clean up.

- **`GET /readyz`** (readiness) — checks DB and Redis connectivity. Returns:
  - 200 `{ status: 'ready', checks: { db: 'ok', redis: 'ok' } }` when all pass
  - 503 `{ status: 'degraded', checks: { db: 'ok' | 'error', redis: 'ok' | 'error' } }` when any fail

### Implementation

**`src/modules/health/health.service.ts`** — replace stub with:
- `checkDb()`: imports `db` from `infra/db/client`, runs `db.execute(sql\`SELECT 1\`)`, returns `'ok'` or `'error'`
- `checkRedis()`: imports shared Redis client, calls `.ping()`, returns `'ok'` or `'error'`
- `readiness()`: runs both checks concurrently via `Promise.allSettled`, returns aggregate status

**`src/infra/db/client.ts`** — add `closeDb()` export that calls `client.end()`. Used by `destroySubsystems()` to fix the graceful shutdown hang.

**`src/infra/redis/client.ts`** — add a lazily-created shared singleton via `getSharedRedisClient()`. Returns a cached Redis instance. Health probe and bootstrap both use this instead of creating ad-hoc clients. Add `closeSharedRedisClient()` for shutdown.

**`src/app/create-app.ts`** — add `GET /readyz` route next to existing `/healthz`.

### Testing

- Mock `db.execute` and Redis `.ping()` to test ok/error/mixed scenarios
- Test that `/readyz` returns 503 when either check fails

---

## 2. Security — CORS + Headers

### CORS

**`src/config/env.ts`** — add `CORS_ALLOWED_ORIGINS: z.string().optional()` (comma-separated, e.g. `https://app.supplymind.ai,http://localhost:3000`).

**`src/app/create-app.ts`** — replace `app.use('*', cors())` with:
- Workspace routes (`/api/v1/*`): restrictive CORS using parsed `CORS_ALLOWED_ORIGINS`. When env var is unset, default to `['http://localhost:3000', 'http://localhost:3001']` in dev. Include `credentials: true`.
- Public routes (`/`, `/mcp`, `/.well-known/*`): keep `origin: '*'` since A2A and MCP serve non-browser clients.

### Security Headers

**`src/app/create-app.ts`** — add Hono's built-in `secureHeaders()` middleware globally:

```typescript
import { secureHeaders } from 'hono/secure-headers';

app.use('*', secureHeaders({
  contentSecurityPolicy: false,       // JSON API, no HTML
  crossOriginEmbedderPolicy: false,   // not serving embeddable content
  xFrameOptions: 'DENY',
  strictTransportSecurity: 'max-age=63072000; includeSubDomains',
  referrerPolicy: 'strict-origin-when-cross-origin',
}));
```

### Testing

- Test that workspace routes reject disallowed origins (preflight returns no `Access-Control-Allow-Origin`)
- Test that public routes accept any origin
- Test that security headers are present on all responses

---

## 3. Novu Notification Provider

### Dependency Cleanup

Remove `@novu/node` (legacy v2) from `package.json`. Keep only `@novu/api` v3.

### Implementation

**`src/infra/notifications/novu.ts`** — replace stub with:

```typescript
import { Novu } from '@novu/api';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

let client: Novu | null = null;

export function getNovuClient(): Novu | null {
  if (!env.NOVU_API_KEY) return null;
  if (!client) client = new Novu({ secretKey: env.NOVU_API_KEY });
  return client;
}

export async function triggerNotification(
  workflowId: string,
  subscriberId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const novu = getNovuClient();
  if (!novu) {
    logger.warn('Novu not configured — skipping notification');
    return;
  }
  await novu.trigger({ name: workflowId, to: { subscriberId }, payload });
}
```

**`src/modules/notifications/channels/in-app/novu.provider.ts`** — delete stub or make it re-export from `src/infra/notifications/novu.ts`.

### Workflow IDs

Define typed constants for notification workflow IDs used by the app:

```typescript
export const NovuWorkflows = {
  AGENT_FAILURE: 'agent-failure',
  TASK_COMPLETED: 'task-completed',
  API_KEY_CREATED: 'api-key-created',
  WORKSPACE_INVITATION: 'workspace-invitation',
} as const;
```

These correspond to workflows configured in the Novu dashboard. The backend only triggers them — Novu owns templates and delivery.

### Testing

- Mock Novu client, verify `triggerNotification` calls with correct params
- Test graceful degradation when `NOVU_API_KEY` is unset (no-op, no crash)

---

## 4. OTel — Bun-Compatible Tracing

### Dependency Changes

- **Remove**: `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node` (incompatible with Bun — they rely on `diagnostics_channel` and Node.js HTTP monkey-patching)
- **Keep**: `@opentelemetry/api` (already used by `withSpan()`)
- **Add**: `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions` (none of these are currently installed)

### Implementation

**`src/infra/observability/otel.ts`** — extend with `initOtel()`:

```typescript
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let provider: BasicTracerProvider | null = null;

export function initOtel(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.info('OTel: no OTEL_EXPORTER_OTLP_ENDPOINT — traces disabled');
    return;
  }

  const resource = new Resource({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'supplymind-backend' });
  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  provider = new BasicTracerProvider({ resource });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  logger.info({ endpoint }, 'OTel: tracing initialized');
}

export async function shutdownOtel(): Promise<void> {
  if (provider) await provider.shutdown();
}
```

The existing `withSpan()` helper and `tracer` continue to work — once `provider.register()` is called, `trace.getTracer()` returns a real tracer instead of a no-op.

**`src/app/bootstrap.ts`** — call `initOtel()` early in `initSubsystems()` (before other subsystems so their spans are captured). Call `shutdownOtel()` in `destroySubsystems()`.

### Testing

- Test that `initOtel()` no-ops gracefully when env var is missing
- Test that `withSpan()` still works (no regression)

---

## 5. Cleanup Job

### Implementation

**`src/jobs/cleanup/index.ts`** — BullMQ repeatable job, default schedule: every 15 minutes.

Four cleanup tasks, run sequentially within each job execution:

1. **Stale tasks**: Add `taskRepo.findStale(status, olderThanMs)` to `src/infra/a2a/task-repo.ts`:
   ```typescript
   async findStale(status: TaskState, olderThanMs: number): Promise<A2ATask[]> {
     const cutoff = new Date(Date.now() - olderThanMs);
     return db.select().from(a2aTasks)
       .where(and(eq(a2aTasks.status, status), lt(a2aTasks.updatedAt, cutoff)));
   }
   ```
   Default timeouts: 30 min for `working`, 60 min for `submitted`. Mark as `failed` with `message: 'Timed out — no progress'`.

2. **Expired sessions**: Call `sessionsService.expireIdleSessions()` (already implemented, 24h default).

3. **Expired API keys**: Add `apiKeysRepo.deleteExpired()`:
   ```typescript
   async deleteExpired(): Promise<number> {
     const result = await db.delete(apiKeys)
       .where(and(isNotNull(apiKeys.expiresAt), lt(apiKeys.expiresAt, new Date())));
     return result.rowCount ?? 0;
   }
   ```

4. **Dead letter drain**: If EventBus exposes dead letter entries, archive those older than 7 days. If no dead letter store exists, skip this (just log a count if available).

**Job registration** in bootstrap: use `cleanupQueue.upsertJobScheduler('cleanup-sweep', { pattern: '*/15 * * * *' }, { name: 'cleanup' })`. Add a new `cleanupQueue` to `src/infra/queue/bullmq.ts`.

### Testing

- Mock repos, verify each cleanup step is called with correct thresholds
- Test that individual step failures don't abort the entire job (each step wrapped in try/catch)

---

## 6. Sync Job — Agent Registry Refresh

### Implementation

**`src/modules/agent-registry/agent-registry.service.ts`** — add `refreshAll()`:

```typescript
async refreshAll(): Promise<{ refreshed: number; failed: number }> {
  const agents = await agentRegistryRepo.findAll();
  let refreshed = 0, failed = 0;
  for (const agent of agents) {
    try {
      await this.refresh(agent.workspaceId, agent.id);
      refreshed++;
    } catch (err) {
      logger.warn({ agentId: agent.id, error: err }, 'Agent refresh failed');
      failed++;
    }
  }
  return { refreshed, failed };
}
```

This reuses the existing per-agent `refresh()` which already handles URL fetching, DB update, and `workerRegistry` reload — no wipe-and-reload, no brief empty window.

**`src/jobs/sync/index.ts`** — BullMQ repeatable job, default schedule: every hour.

**Job registration** in bootstrap: `syncQueue.upsertJobScheduler('agent-registry-sync', { pattern: '0 * * * *' }, { name: 'agent-sync' })`. Add `syncQueue` to `src/infra/queue/bullmq.ts`.

### Testing

- Mock `agentRegistryRepo.findAll()` + `refresh()`, verify all agents are attempted
- Test that one agent failing doesn't abort the sweep

---

## 7. Bootstrap Fixes

1. **Delete duplicate `startOrchestrationWorkers()`** — remove the second call at lines 152-159 of `bootstrap.ts`
2. **Wire `initOtel()`** — call at the beginning of `initSubsystems()`, before other steps
3. **Fix DB shutdown** — export `closeDb()` from `src/infra/db/client.ts`, call it in `destroySubsystems()`
4. **Shared Redis client** — refactor bootstrap to use `getSharedRedisClient()` from `src/infra/redis/client.ts` instead of creating ad-hoc clients. Pass the shared client to `RedisPubSub` and cache.
5. **Register cleanup + sync job schedulers** — add to bootstrap after queue initialization
6. **Sentry** — already correctly wired in `index.ts`, no change needed

### Minor fix (from A2UI plan)

**`src/modules/skills/providers/builtin.provider.ts`** — in the `request_user_input` skill handler, set task status to `input_required` before awaiting `createInputRequest()`. Currently the task stays in `working` state during the pause, which means the UI never sees the `input_required` status.

---

## Files Modified/Created

| File | Change |
|------|--------|
| `src/modules/health/health.service.ts` | Replace stub — DB + Redis checks |
| `src/app/create-app.ts` | Add `/readyz`, CORS config, `secureHeaders()` |
| `src/config/env.ts` | Add `CORS_ALLOWED_ORIGINS` |
| `src/infra/db/client.ts` | Export `closeDb()` |
| `src/infra/redis/client.ts` | Add `getSharedRedisClient()`, `closeSharedRedisClient()` |
| `src/infra/notifications/novu.ts` | Replace stub — Novu v3 provider |
| `src/infra/observability/otel.ts` | Add `initOtel()`, `shutdownOtel()` with BasicTracerProvider |
| `src/infra/a2a/task-repo.ts` | Add `findStale(status, olderThanMs)` |
| `src/modules/api-keys/api-keys.repo.ts` | Add `deleteExpired()` |
| `src/modules/agent-registry/agent-registry.service.ts` | Add `refreshAll()` |
| `src/infra/queue/bullmq.ts` | Add `cleanupQueue`, `syncQueue` |
| `src/jobs/cleanup/index.ts` | Replace stub — repeatable cleanup job |
| `src/jobs/sync/index.ts` | Replace stub — agent registry sync job |
| `src/app/bootstrap.ts` | Fix dup workers, wire OTel, wire jobs, shared Redis, DB shutdown |
| `src/modules/skills/providers/builtin.provider.ts` | Set task status to `input_required` during pause |
| `package.json` | Remove `@novu/node`, verify OTel deps |
