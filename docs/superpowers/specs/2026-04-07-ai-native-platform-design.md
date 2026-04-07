# AI-Native Platform Design — V1

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Plugin Platform Core + Execution Layer + ERP Sync (Business Central)
**Source of Truth:** `C:\Users\Xrey\SupplyMindAI\backend`

---

## 1. Architectural Overview

Three new layers sit above the existing infra — each with clear downward dependencies and no upward coupling:

```
┌──────────────────────────────────────────────────────────┐
│  ERP Sync Plugin — Business Central (Domain Layer)       │
├──────────────────────────────────────────────────────────┤
│  ExecutionPlan / Intent-Gate (Execution Layer)           │
│  Compiles to OrchestrationDefinition — engine unchanged  │
├──────────────────────────────────────────────────────────┤
│  Plugin Platform — DB, Lifecycle, Event-Source (Platform)│
├──────────────────────────────────────────────────────────┤
│  Existing Infra: A2A · MCP · BullMQ · Redis · Drizzle    │
└──────────────────────────────────────────────────────────┘
```

Plugin lifecycle state is **event-sourced**: every transition writes an immutable event to `plugin_events` and updates the projected state in `plugin_installations` — in one transaction. No state change without an event.

---

## 2. Plugin Platform Core

### 2.1 Plugin Types

All four types are supported and persisted in DB. `local_sandboxed` requires an operator-set Feature Flag per workspace — no self-service, no silent fallback.

| Kind | Prod Default | Feature Flag |
|---|---|---|
| `remote_mcp` | enabled | — |
| `remote_a2a` | enabled | — |
| `webhook` | enabled | — |
| `local_sandboxed` | disabled | `plugins.local_sandboxed.enabled` |

### 2.2 Database Schema

#### `plugin_catalog` — global, read-only per workspace
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
name            text NOT NULL
version         text NOT NULL
kind            plugin_kind_enum NOT NULL  -- remote_mcp | remote_a2a | webhook | local_sandboxed
capabilities    jsonb NOT NULL DEFAULT '[]'  -- ['mcp_tool','a2a_agent','skill_provider','webhook_handler']
required_permissions jsonb NOT NULL DEFAULT '[]'
manifest        jsonb NOT NULL             -- full PluginManifestV1
publisher       text
verified        boolean NOT NULL DEFAULT false
created_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (name, version)
```

#### `plugin_installations` — per workspace, projected state
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
plugin_id       uuid NOT NULL REFERENCES plugin_catalog(id)
status          plugin_status_enum NOT NULL DEFAULT 'installing'
                -- installing | active | disabled | failed | uninstalling | uninstalled
pinned_version  text
config          jsonb NOT NULL DEFAULT '{}'
secret_binding_ids jsonb NOT NULL DEFAULT '[]'  -- refs to credentials table
policy_binding  jsonb NOT NULL DEFAULT '{}'     -- approvalMode, riskClass overrides
installed_at    timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (workspace_id, plugin_id)
INDEX (workspace_id)
```

#### `plugin_events` — append-only event log
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
installation_id uuid NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE
workspace_id    uuid NOT NULL
event_type      plugin_event_type_enum NOT NULL
                -- installed | enabled | disabled | config_updated | version_pinned
                -- health_checked | uninstalled | rollback_initiated | rollback_completed
actor_id        text NOT NULL
actor_type      text NOT NULL  -- user | api_key | system
payload         jsonb NOT NULL DEFAULT '{}'  -- diff or full snapshot per event type
created_at      timestamptz NOT NULL DEFAULT now()
INDEX (installation_id, created_at)
INDEX (workspace_id, created_at)
```

#### `plugin_health_checks` — latest health per installation
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
installation_id uuid NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE
checked_at      timestamptz NOT NULL DEFAULT now()
status          text NOT NULL  -- healthy | degraded | unreachable
latency_ms      integer
error           text
metadata        jsonb NOT NULL DEFAULT '{}'
INDEX (installation_id, checked_at DESC)
```

### 2.3 Lifecycle State Machine

```
install    → [installing] ──(success)──→ active
                          ──(failure)──→ failed
enable     → disabled ──────────────→ active
disable    → active ────────────────→ disabled
update     → active ────────────────→ active   (config_updated event)
pin        → active ────────────────→ active   (version_pinned event)
health     → any ───────────────────→ any      (health_checked event, status unchanged)
uninstall  → active|disabled ───────→ uninstalling ──(cleanup)──→ uninstalled (row + events kept)
rollback   → failed|disabled ───────→ rollback_initiated ──→ active (last version_pinned event payload)
           Precondition: at least one prior version_pinned event must exist, else rollback returns 409.
```

Every transition: write `plugin_events` row + update `plugin_installations.status` in one DB transaction. Also write to `audit_logs` in the same transaction.

### 2.4 Permission Model

```typescript
type PluginPermission =
  | 'workspace:read'        // default for all plugins
  | 'workspace:write'
  | 'credentials:bind'      // may create secret bindings
  | 'agent:invoke'          // may invoke agents
  | 'hitl:request'          // may open HITL gates
  | 'erp:read'
  | 'erp:write'             // requires approvalMode: 'required' — not overridable
  | 'local_sandboxed:run'   // operator-only + feature flag
```

Install fails with an explicit error if the caller lacks required permissions. No silent downgrade.

### 2.5 New API Group — Plugin Catalog & Lifecycle

```
GET    /api/v1/plugin-catalog                          list available plugins
GET    /api/v1/plugin-catalog/:id                      get plugin details

POST   /api/v1/workspaces/:wid/plugins/install         install plugin
GET    /api/v1/workspaces/:wid/plugins                 list installed plugins
GET    /api/v1/workspaces/:wid/plugins/:id             get installation
PATCH  /api/v1/workspaces/:wid/plugins/:id/config      update config
POST   /api/v1/workspaces/:wid/plugins/:id/enable      enable
POST   /api/v1/workspaces/:wid/plugins/:id/disable     disable
POST   /api/v1/workspaces/:wid/plugins/:id/pin         pin version
POST   /api/v1/workspaces/:wid/plugins/:id/uninstall   uninstall
POST   /api/v1/workspaces/:wid/plugins/:id/rollback    rollback
GET    /api/v1/workspaces/:wid/plugins/:id/events      event log (replay source)
GET    /api/v1/workspaces/:wid/plugins/:id/health      latest health check
POST   /api/v1/workspaces/:wid/plugins/:id/health/run  trigger health check now
```

---

## 3. Execution Layer

### 3.1 ExecutionPlan

`ExecutionPlan` is a high-level artifact that compiles to `OrchestrationDefinition` at run-time. The existing `OrchestrationEngine` is not modified.

#### New DB Tables

**`execution_plans`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
name            text
intent          jsonb         -- IntentClassification result
steps           jsonb NOT NULL -- ExecutionStep[] (superset of OrchestrationStep)
input           jsonb NOT NULL DEFAULT '{}'
policy          jsonb NOT NULL DEFAULT '{}'  -- ExecutionPolicy
status          execution_plan_status_enum NOT NULL DEFAULT 'draft'
                -- draft | pending_approval | running | completed | failed | cancelled
created_by      text NOT NULL
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
INDEX (workspace_id, created_at)
```

**`execution_runs`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
plan_id         uuid NOT NULL REFERENCES execution_plans(id)
orchestration_id uuid REFERENCES orchestrations(id)
workspace_id    uuid NOT NULL
status          text NOT NULL
intent          jsonb         -- classification at run time
started_at      timestamptz NOT NULL DEFAULT now()
completed_at    timestamptz
INDEX (plan_id, started_at)
```

#### Extended Step Fields (additive, no breaking changes)
```typescript
interface ExecutionStepExtensions {
  riskClass?:    'low' | 'medium' | 'high' | 'critical'
  approvalMode?: 'auto' | 'ask' | 'required'
  pluginId?:     string   // uuid
  capabilityId?: string
}
```

### 3.2 IntentClassification

```typescript
interface IntentClassification {
  category:   'quick' | 'deep' | 'visual' | 'ops'
  confidence: number          // 0–1
  method:     'rules' | 'llm' // which stage classified
  reasoning?: string          // LLM output only
  cached:     boolean
}
```

### 3.3 Intent-Gate

Middleware invoked before every `plan.run`. Two stages:

**Stage 1 — Rule-based (synchronous, no LLM):**

| Condition | Classification |
|---|---|
| Any step with `riskClass: 'critical'` | `ops` + approval_required |
| Steps with `type: 'agent'` + unknown agentId | `deep` |
| Only `skill` steps, no external tools | `quick` |
| Any `gate` step or `approvalMode: 'required'` | `ops` |
| External webhook steps | `ops` |

If no rule matches → Stage 2.

**Stage 2 — LLM Fallback (only when Stage 1 = unresolved):**
- Model: `intent_gate.model` workspace setting, default `claude-haiku-4-5-20251001`
- Timeout: `intent_gate.timeout_ms` (default 2000ms) — timeout falls back to `quick`
- Cache: Redis, TTL 5min, key = SHA256(plan schema + input hash)
- Budget: `intent_gate.llm_budget_daily` calls/day per workspace (Redis counter)

**Workspace-level config (stored in workspace_settings):**
```jsonb
{
  "intent_gate.enabled": true,
  "intent_gate.llm_fallback": true,
  "intent_gate.model": "claude-haiku-4-5-20251001",
  "intent_gate.timeout_ms": 2000,
  "intent_gate.risk_overrides": {
    "critical": "require_approval",
    "high": "require_approval",
    "medium": "warn",
    "low": "allow"
  }
}
```

### 3.4 Plan/Execute Flow

```
POST /plans                → create ExecutionPlan (status: draft)
POST /plans/:id/run        → Intent-Gate
                              → if approval_required: status = pending_approval
                                  → InboxItem for operator
                                  → wait for POST /plans/:id/approve
                              → compile ExecutionPlan → OrchestrationDefinition
                              → create orchestration (existing engine)
                              → create execution_run row
                              → return { planId, runId, orchestrationId }
POST /plans/:id/approve    → resolve pending_approval → trigger run
GET  /plans/:id            → plan status + latest run
GET  /plans/:id/runs       → all runs for this plan
```

### 3.5 Surface Parity

Every plan operation is available on all three surfaces:

| Operation | REST | SDK/Gateway op | A2A Skill |
|---|---|---|---|
| plan.create | POST /plans | `plan.create` | `execution:plan.create` |
| plan.run | POST /plans/:id/run | `plan.run` | `execution:plan.run` |
| plan.approve | POST /plans/:id/approve | `plan.approve` | `execution:plan.approve` |
| plan.get | GET /plans/:id | `plan.get` | `execution:plan.get` |

No feature is available on fewer than all three surfaces.

---

## 4. ERP Sync Plugin — Business Central

### 4.1 File Structure

```
src/plugins/erp-bc/
  manifest.ts                    PluginManifestV1 registration
  connector/
    bc-client.ts                 OData v4 client, OAuth2 Client Credentials
    bc-auth.ts                   token refresh, Redis cache, credential binding
    bc-types.ts                  PurchaseOrder, Vendor, GLEntry, Item, ...
  sync/
    sync-job.ts                  SyncJob definition and scheduling
    sync-runner.ts               executes jobs, writes sync_records, emits events
    sync-errors.ts               TransientError | PermanentError | ConflictError | AuthError | RateLimitError
    retry-strategy.ts            exponential backoff, dead-letter after max_retries
  hitl/
    approval-gate.ts             HITL gate for critical write actions
    approval-schemas.ts
  skills/
    sync-now.ts                  skill: trigger immediate sync for entity type
    get-entity.ts                skill: fetch single BC entity by id
    post-action.ts               skill: write action (always via HITL gate)
  __tests__/
    bc-client.test.ts
    sync-runner.test.ts
    retry-strategy.test.ts
    hitl.test.ts
```

### 4.2 Business Central Connector

- Protocol: OData v4 (`/api/v2.0/companies({id})/...`)
- Auth: OAuth2 Client Credentials (Azure AD tenant), token cached in Redis (TTL = expires_in - 60s)
- On 401: force token refresh once, then fail with `AuthError`
- Credentials stored in `credentials` table (AES-256-GCM, existing infrastructure)

Supported entities in V1: `purchaseOrders`, `vendors`, `glEntries`, `items`, `customers`

### 4.3 Sync-Job System

#### New DB Tables

**`sync_jobs`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
installation_id uuid NOT NULL REFERENCES plugin_installations(id)
workspace_id    uuid NOT NULL
entity_type     text NOT NULL  -- purchase_order | vendor | gl_entry | item | customer
filter          jsonb          -- OData $filter expression
cursor          text           -- last processed ETag or modifiedAt
batch_size      integer NOT NULL DEFAULT 100
schedule        text           -- cron expression, null = manual only
status          text NOT NULL DEFAULT 'idle'  -- idle | running | failed | paused
last_run_at     timestamptz
last_error      text
retry_count     integer NOT NULL DEFAULT 0
created_at      timestamptz NOT NULL DEFAULT now()
INDEX (workspace_id, entity_type)
```

**`sync_records`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
job_id          uuid NOT NULL REFERENCES sync_jobs(id)
workspace_id    uuid NOT NULL
entity_type     text NOT NULL
entity_id       text NOT NULL
action          text NOT NULL  -- created | updated | deleted | skipped | failed
payload_hash    text           -- SHA256 for deduplication
error           text
created_at      timestamptz NOT NULL DEFAULT now()
INDEX (job_id, created_at)
INDEX (workspace_id, entity_type, created_at)
```

### 4.4 Error Classes and Retry Strategy

| Error Class | Trigger | Strategy |
|---|---|---|
| `TransientError` | network, 5xx | exponential backoff, max 5 retries |
| `AuthError` | 401, expired token | token refresh + 1 retry |
| `ConflictError` | BC ETag mismatch | fetch-then-retry, max 3 retries |
| `PermanentError` | 400, schema error | no retry → dead-letter + notification |
| `RateLimitError` | 429 | backoff using Retry-After header |

Dead-letter = `sync_records` row with `action: 'failed'` + InboxItem + Notification.

Replay endpoint: `POST /api/v1/workspaces/:wid/sync-jobs/:id/replay`

### 4.5 Human-in-the-Loop Gate

Critical write actions (post invoice, delete vendor, cancel order) always route through the `GateStep` system:

```
SyncRunner detects exception requiring human approval
  → creates ExecutionPlan with GateStep + riskClass: 'critical'
  → Intent-Gate classifies as 'ops', approval_required
  → InboxItem created for operator
  → Operator approves/rejects via REST or UI
  → Gate resolves → BC write action executes or aborts
```

HITL-eligible actions declared in manifest:
```typescript
hitlActions: ['postInvoice', 'deleteVendor', 'cancelOrder', 'modifyGLEntry']
```

`erp:write` permission has `approvalMode: 'required'` hardcoded — not overridable by workspace config.

### 4.6 Reference Workflow (installed as WorkflowTemplate)

```
[SyncJob: PurchaseOrders]
  → [SkillStep: erp-bc:sync-now]      entity_type: purchase_order
  → [DecisionStep: has_exceptions]    condition: ${steps.sync.result.exceptions} > 0
      → yes: [GateStep: operator_approval]  riskClass: critical
               → [SkillStep: erp-bc:post-action]
      → no:  [SkillStep: erp-bc:mark-complete]
```

---

## 5. Security & Guardrails

### 5.1 Strict-by-Default Rules

| Guardrail | Enforcement |
|---|---|
| Cross-workspace access | `workspaceId` assert on every DB query — middleware enforced, no bypass |
| `local_sandboxed` in prod | Hard block when feature flag off (default). No fallback. |
| `erp:write` without approval | `approvalMode: 'required'` in BC manifest — not overridable |
| Credential exposure | Decrypted only in worker context, never in API responses or logs |
| Intent-Gate bypass | Only via `intent_gate.enabled: false` flag — operator-only |
| Plugin config schema | Zod-validated at install time. Invalid config → install rejected |
| Plugin permissions | Missing required permission → install fails with explicit error |

### 5.2 Rate Limits

```
plugin:install          10 / min per workspace
sync:run               100 / hour per workspace (configurable via feature flag)
hitl:open               50 concurrent open gates per workspace
intent_gate:llm        1000 LLM calls / day per workspace (Redis counter, 24h TTL)
bc:api                  Token-bucket per workspace, respects BC Retry-After headers
```

### 5.3 SLO / SLI Targets

| Metric | SLO |
|---|---|
| `plan.run` p99 latency (excluding LLM steps) | < 500ms |
| Intent-Gate rule stage p99 | < 50ms |
| Sync-Job start latency after schedule trigger | < 30s |
| HITL gate InboxItem delivery after trigger | < 5s |
| Plugin install p99 | < 3s |

Metrics via OpenTelemetry (`src/infra/observability/`).

### 5.4 Audit Trail

Every plugin lifecycle action writes atomically to:
1. `plugin_events` — event-sourced, replay-capable
2. `audit_logs` — existing, cross-resource queryable

Both writes in one DB transaction. No lifecycle action without both.

---

## 6. Feature Flag Rollout

```
plugins.platform.enabled           Phase 1 (plugin platform)
execution.plans.enabled            Phase 2 (execution layer)
intent_gate.enabled                Intent-Gate (default: true once Phase 2 is live)
intent_gate.llm_fallback           LLM stage (default: true, can be disabled per workspace)
erp_bc.enabled                     Phase 3 (BC plugin)
erp_bc.write_actions.enabled       BC write actions separately
plugins.local_sandboxed.enabled    Operator-only, never default-on
```

All flags managed via existing `feature-flags` module. No new code path activates a feature without a flag check.

---

## 7. Test Plan / Acceptance Criteria

### Plugin Lifecycle E2E
- Install → activate → update config → pin version → rollback → uninstall
- Verify: `plugin_events` contains correct sequence, `plugin_installations.status` matches projection
- Verify: cross-workspace install attempt rejected
- Verify: `local_sandboxed` install blocked when flag off

### Security / Isolation
- No workspace can read or modify another workspace's plugin installation
- `erp:write` without approval: request rejected at intent gate
- Sensitive capability with missing permission: install returns explicit error (not 500)

### Orchestration E2E
- Mixed DAG with all step types (skill, agent, gate, decision, collaboration)
- Gate rejection: downstream steps skipped, plan status = failed
- Retry: TransientError retried up to max, then dead-lettered
- Plan re-run: new `execution_run` row, same plan id

### Surface Parity
- Identical use-case (plan.create → plan.run → result) via REST, SDK/Gateway, and A2A skill
- Results structurally identical across all three surfaces

### BC Sync E2E
- Full sync cycle: idle → running → idle, sync_records populated
- ConflictError: fetch-then-retry resolves, record shows `updated`
- PermanentError: dead-letter created, notification and inbox item sent
- HITL gate: write action paused, approved by operator, BC action executed
- HITL gate: rejected by operator, write action aborted, sync_record `failed`

---

## 8. Implementation Phases

| Phase | Scope | Estimated Output |
|---|---|---|
| 0 | Repo baseline, migrations, feature flags | DB migrations, flag definitions |
| 1 | Plugin Platform (catalog, installations, lifecycle, events, health) | ~12 files |
| 2 | Execution Layer (ExecutionPlan, Intent-Gate, Plan/Execute API, surface parity) | ~10 files |
| 3 | ERP Sync Plugin — Business Central | ~15 files |
| 4 | Production hardening (rate limits, SLO metrics, dead-letter replay, runbook) | ~6 files |
