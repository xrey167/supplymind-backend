# Plugin Platform Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, event-sourced Plugin Platform to the backend — catalog, per-workspace installations, lifecycle state machine, health checks, and full REST API.

**Architecture:** Four new DB tables (`plugin_catalog`, `plugin_installations`, `plugin_events`, `plugin_health_checks`). Every lifecycle transition writes an immutable event + updates projected status in one DB transaction. New module `src/modules/plugins/` mirrors the orchestration module pattern. Routes mounted at `/api/v1/plugin-catalog` (global) and `/api/v1/workspaces/:wid/plugins` (workspace).

**Tech Stack:** Bun · Hono + @hono/zod-openapi · Drizzle ORM · Postgres · bun:test · Zod

---

## File Structure

```
src/infra/db/schema/index.ts                (M) add 4 tables + 3 enums
drizzle/                                    (M) new migration file (generated)
src/config/flags.ts                         (M) add plugin feature flags
src/modules/plugins/
  plugins.types.ts                          (N) PluginKind, PluginStatus, PluginPermission, PluginManifestV1, InstallationRow, EventRow
  plugins.schemas.ts                        (N) Zod schemas for API request/response
  plugins.catalog.repo.ts                   (N) CRUD for plugin_catalog
  plugins.installation.repo.ts              (N) CRUD + event writes for plugin_installations + plugin_events
  plugins.health.repo.ts                    (N) CRUD for plugin_health_checks
  plugins.service.ts                        (N) lifecycle business logic (install/enable/disable/pin/uninstall/rollback)
  plugins.catalog.routes.ts                 (N) GET /plugin-catalog, GET /plugin-catalog/:id
  plugins.routes.ts                         (N) workspace-scoped install/enable/disable/pin/uninstall/rollback/events/health routes
  plugins.manifest-validator.ts             (N) Zod-validate plugin config against manifest schema
  __tests__/
    plugins.service.test.ts                 (N) unit tests for lifecycle state machine
    plugins.catalog.repo.test.ts            (N) unit test with mock DB
tests/integration/
  plugins.test.ts                           (N) full E2E lifecycle integration test
src/api/routes/workspace/index.ts           (M) mount plugin routes
src/app/create-app.ts                       (M) mount catalog routes
```

---

## Task 1: DB Schema — Enums and Tables

**Files:**
- Modify: `src/infra/db/schema/index.ts`

- [ ] **Step 1: Add enums and tables at the end of the schema file**

Open `src/infra/db/schema/index.ts` and append after the last table definition:

```typescript
// ── Plugin Platform ──────────────────────────────────────────────────────────

export const pluginKindEnum = pgEnum('plugin_kind', [
  'remote_mcp', 'remote_a2a', 'webhook', 'local_sandboxed',
]);

export const pluginStatusEnum = pgEnum('plugin_status', [
  'installing', 'active', 'disabled', 'failed', 'uninstalling', 'uninstalled',
]);

export const pluginEventTypeEnum = pgEnum('plugin_event_type', [
  'installed', 'enabled', 'disabled', 'config_updated', 'version_pinned',
  'health_checked', 'uninstalled', 'rollback_initiated', 'rollback_completed',
]);

export const pluginCatalog = pgTable('plugin_catalog', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  kind: pluginKindEnum('kind').notNull(),
  capabilities: jsonb('capabilities').notNull().default([]),
  requiredPermissions: jsonb('required_permissions').notNull().default([]),
  manifest: jsonb('manifest').notNull().default({}),
  publisher: text('publisher'),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('pc_name_version_idx').on(t.name, t.version),
]);

export const pluginInstallations = pgTable('plugin_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pluginId: uuid('plugin_id').notNull().references(() => pluginCatalog.id),
  status: pluginStatusEnum('status').notNull().default('installing'),
  pinnedVersion: text('pinned_version'),
  config: jsonb('config').notNull().default({}),
  secretBindingIds: jsonb('secret_binding_ids').notNull().default([]),
  policyBinding: jsonb('policy_binding').notNull().default({}),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('pi_workspace_plugin_idx').on(t.workspaceId, t.pluginId),
  index('pi_workspace_idx').on(t.workspaceId),
]);

export const pluginEvents = pgTable('plugin_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: uuid('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  eventType: pluginEventTypeEnum('event_type').notNull(),
  actorId: text('actor_id').notNull(),
  actorType: text('actor_type').notNull(),  // user | api_key | system
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pe_installation_created_idx').on(t.installationId, t.createdAt),
  index('pe_workspace_created_idx').on(t.workspaceId, t.createdAt),
]);

export const pluginHealthChecks = pgTable('plugin_health_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: uuid('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull(),  // healthy | degraded | unreachable
  latencyMs: integer('latency_ms'),
  error: text('error'),
  metadata: jsonb('metadata').notNull().default({}),
}, (t) => [
  index('phc_installation_checked_idx').on(t.installationId, t.checkedAt),
]);
```

- [ ] **Step 2: Generate and apply migration**

```bash
bun run db:generate
bun run db:migrate
bun run db:migrate:test
```

Expected: new migration file in `drizzle/`, both dev and test DBs updated.

- [ ] **Step 3: Commit**

```bash
git add src/infra/db/schema/index.ts drizzle/
git commit -m "feat(plugins): add plugin platform DB schema (4 tables, 3 enums)"
```

---

## Task 2: Feature Flags

**Files:**
- Modify: `src/config/flags.ts`

- [ ] **Step 1: Add plugin feature flags**

In `src/config/flags.ts`, add to `DEFAULT_FLAGS`:

```typescript
  'plugins.platform.enabled': false,
  'plugins.local_sandboxed.enabled': false,
  'intent_gate.enabled': false,
  'intent_gate.llm_fallback': false,
  'erp_bc.enabled': false,
  'erp_bc.write_actions.enabled': false,
```

- [ ] **Step 2: Commit**

```bash
git add src/config/flags.ts
git commit -m "feat(plugins): add plugin + execution + erp feature flags"
```

---

## Task 3: Plugin Types

**Files:**
- Create: `src/modules/plugins/plugins.types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/modules/plugins/plugins.types.ts

export type PluginKind = 'remote_mcp' | 'remote_a2a' | 'webhook' | 'local_sandboxed';

export type PluginStatus =
  | 'installing' | 'active' | 'disabled' | 'failed' | 'uninstalling' | 'uninstalled';

export type PluginEventType =
  | 'installed' | 'enabled' | 'disabled' | 'config_updated' | 'version_pinned'
  | 'health_checked' | 'uninstalled' | 'rollback_initiated' | 'rollback_completed';

export type PluginPermission =
  | 'workspace:read' | 'workspace:write'
  | 'credentials:bind' | 'agent:invoke' | 'hitl:request'
  | 'erp:read' | 'erp:write' | 'local_sandboxed:run';

export interface PluginCapability {
  id: string;   // e.g. 'mcp_tool', 'a2a_agent', 'skill_provider', 'webhook_handler'
  config?: Record<string, unknown>;
}

export interface PluginManifestV1 {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  description: string;
  author?: string;
  capabilities: PluginCapability[];
  requiredPermissions: PluginPermission[];
  configSchema?: Record<string, unknown>;   // JSON Schema for workspace config
  hitlActions?: string[];                   // action names requiring HITL approval
  healthCheckUrl?: string;                  // GET endpoint returning { status: 'ok' | 'degraded' }
  onInstall?: (workspaceId: string, config: Record<string, unknown>) => Promise<void>;
  onUninstall?: (workspaceId: string) => Promise<void>;
}

export interface CatalogRow {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  capabilities: PluginCapability[];
  requiredPermissions: PluginPermission[];
  manifest: Record<string, unknown>;
  publisher: string | null;
  verified: boolean;
  createdAt: Date;
}

export interface InstallationRow {
  id: string;
  workspaceId: string;
  pluginId: string;
  status: PluginStatus;
  pinnedVersion: string | null;
  config: Record<string, unknown>;
  secretBindingIds: string[];
  policyBinding: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
}

export interface PluginEventRow {
  id: string;
  installationId: string;
  workspaceId: string;
  eventType: PluginEventType;
  actorId: string;
  actorType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface HealthCheckRow {
  id: string;
  installationId: string;
  checkedAt: Date;
  status: 'healthy' | 'degraded' | 'unreachable';
  latencyMs: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface Actor {
  id: string;
  type: 'user' | 'api_key' | 'system';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/plugins/plugins.types.ts
git commit -m "feat(plugins): plugin platform types (PluginManifestV1, InstallationRow, etc.)"
```

---

## Task 4: Catalog Repo

**Files:**
- Create: `src/modules/plugins/plugins.catalog.repo.ts`

- [ ] **Step 1: Write the repo**

```typescript
// src/modules/plugins/plugins.catalog.repo.ts

import { db } from '../../infra/db/client';
import { pluginCatalog } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
import type { CatalogRow, PluginManifestV1 } from './plugins.types';

export const pluginCatalogRepo = {
  async findAll(): Promise<CatalogRow[]> {
    return db.select().from(pluginCatalog) as unknown as Promise<CatalogRow[]>;
  },

  async findById(id: string): Promise<CatalogRow | undefined> {
    const [row] = await db.select().from(pluginCatalog).where(eq(pluginCatalog.id, id)).limit(1);
    return row as unknown as CatalogRow | undefined;
  },

  async findByNameVersion(name: string, version: string): Promise<CatalogRow | undefined> {
    const [row] = await db.select().from(pluginCatalog)
      .where(eq(pluginCatalog.name, name))
      .limit(1);
    return row as unknown as CatalogRow | undefined;
  },

  async create(manifest: PluginManifestV1): Promise<CatalogRow> {
    const [row] = await db.insert(pluginCatalog).values({
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
      capabilities: manifest.capabilities,
      requiredPermissions: manifest.requiredPermissions,
      manifest: manifest as unknown as Record<string, unknown>,
    }).returning();
    return row as unknown as CatalogRow;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/plugins/plugins.catalog.repo.ts
git commit -m "feat(plugins): plugin catalog repo"
```

---

## Task 5: Installation Repo

**Files:**
- Create: `src/modules/plugins/plugins.installation.repo.ts`

- [ ] **Step 1: Write the repo**

```typescript
// src/modules/plugins/plugins.installation.repo.ts

import { db } from '../../infra/db/client';
import { pluginInstallations, pluginEvents, auditLogs } from '../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { InstallationRow, PluginEventRow, PluginStatus, PluginEventType, Actor } from './plugins.types';

export const pluginInstallationRepo = {
  async findByWorkspace(workspaceId: string): Promise<InstallationRow[]> {
    return db.select().from(pluginInstallations)
      .where(eq(pluginInstallations.workspaceId, workspaceId)) as unknown as Promise<InstallationRow[]>;
  },

  async findById(id: string): Promise<InstallationRow | undefined> {
    const [row] = await db.select().from(pluginInstallations)
      .where(eq(pluginInstallations.id, id)).limit(1);
    return row as unknown as InstallationRow | undefined;
  },

  async findByWorkspaceAndPlugin(workspaceId: string, pluginId: string): Promise<InstallationRow | undefined> {
    const [row] = await db.select().from(pluginInstallations)
      .where(and(
        eq(pluginInstallations.workspaceId, workspaceId),
        eq(pluginInstallations.pluginId, pluginId),
      )).limit(1);
    return row as unknown as InstallationRow | undefined;
  },

  /**
   * Write event + update projected status in one transaction.
   * This is the only way status is changed — never update status directly.
   */
  async transition(
    installationId: string,
    workspaceId: string,
    newStatus: PluginStatus,
    eventType: PluginEventType,
    actor: Actor,
    payload: Record<string, unknown> = {},
    extraUpdates: Partial<{
      config: Record<string, unknown>;
      pinnedVersion: string;
      policyBinding: Record<string, unknown>;
    }> = {},
  ): Promise<{ installation: InstallationRow; event: PluginEventRow }> {
    return db.transaction(async (tx) => {
      // 1. Write event (immutable)
      const [event] = await tx.insert(pluginEvents).values({
        installationId,
        workspaceId,
        eventType,
        actorId: actor.id,
        actorType: actor.type,
        payload,
      }).returning();

      // 2. Update projected state
      const [installation] = await tx.update(pluginInstallations)
        .set({
          status: newStatus,
          updatedAt: new Date(),
          ...(extraUpdates.config && { config: extraUpdates.config }),
          ...(extraUpdates.pinnedVersion && { pinnedVersion: extraUpdates.pinnedVersion }),
          ...(extraUpdates.policyBinding && { policyBinding: extraUpdates.policyBinding }),
        })
        .where(eq(pluginInstallations.id, installationId))
        .returning();

      // 3. Write to audit_logs for cross-resource queries
      await tx.insert(auditLogs).values({
        workspaceId,
        actorId: actor.id,
        actorType: actor.type,
        action: `plugin.${eventType}`,
        resourceType: 'plugin_installation',
        resourceId: installationId,
        metadata: payload,
      });

      return {
        installation: installation as unknown as InstallationRow,
        event: event as unknown as PluginEventRow,
      };
    });
  },

  async create(data: {
    workspaceId: string;
    pluginId: string;
    config?: Record<string, unknown>;
  }): Promise<InstallationRow> {
    const [row] = await db.insert(pluginInstallations).values({
      workspaceId: data.workspaceId,
      pluginId: data.pluginId,
      status: 'installing',
      config: data.config ?? {},
    }).returning();
    return row as unknown as InstallationRow;
  },

  async getEvents(installationId: string, limit = 50): Promise<PluginEventRow[]> {
    return db.select().from(pluginEvents)
      .where(eq(pluginEvents.installationId, installationId))
      .orderBy(desc(pluginEvents.createdAt))
      .limit(limit) as unknown as Promise<PluginEventRow[]>;
  },

  async getLastVersionPinnedEvent(installationId: string): Promise<PluginEventRow | undefined> {
    const [row] = await db.select().from(pluginEvents)
      .where(and(
        eq(pluginEvents.installationId, installationId),
        eq(pluginEvents.eventType, 'version_pinned'),
      ))
      .orderBy(desc(pluginEvents.createdAt))
      .limit(1);
    return row as unknown as PluginEventRow | undefined;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/plugins/plugins.installation.repo.ts
git commit -m "feat(plugins): plugin installation repo with transactional event-sourced transitions"
```

---

## Task 6: Health Check Repo

**Files:**
- Create: `src/modules/plugins/plugins.health.repo.ts`

- [ ] **Step 1: Write the repo**

```typescript
// src/modules/plugins/plugins.health.repo.ts

import { db } from '../../infra/db/client';
import { pluginHealthChecks } from '../../infra/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { HealthCheckRow } from './plugins.types';

export const pluginHealthRepo = {
  async create(data: {
    installationId: string;
    status: 'healthy' | 'degraded' | 'unreachable';
    latencyMs?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<HealthCheckRow> {
    const [row] = await db.insert(pluginHealthChecks).values({
      installationId: data.installationId,
      status: data.status,
      latencyMs: data.latencyMs,
      error: data.error,
      metadata: data.metadata ?? {},
    }).returning();
    return row as unknown as HealthCheckRow;
  },

  async getLatest(installationId: string): Promise<HealthCheckRow | undefined> {
    const [row] = await db.select().from(pluginHealthChecks)
      .where(eq(pluginHealthChecks.installationId, installationId))
      .orderBy(desc(pluginHealthChecks.checkedAt))
      .limit(1);
    return row as unknown as HealthCheckRow | undefined;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/plugins/plugins.health.repo.ts
git commit -m "feat(plugins): plugin health check repo"
```

---

## Task 7: Manifest Validator

**Files:**
- Create: `src/modules/plugins/plugins.manifest-validator.ts`

- [ ] **Step 1: Write the validator**

```typescript
// src/modules/plugins/plugins.manifest-validator.ts

import { z } from 'zod';

/**
 * Validates workspace-provided config against a plugin's configSchema (JSON Schema subset).
 * Only validates: required fields and basic type checks (string, number, boolean, object, array).
 */
export function validatePluginConfig(
  config: Record<string, unknown>,
  configSchema: Record<string, unknown> | undefined,
): { valid: true } | { valid: false; error: string } {
  if (!configSchema) return { valid: true };

  const properties = (configSchema as any).properties as Record<string, { type: string }> | undefined;
  const required = (configSchema as any).required as string[] | undefined;

  if (required) {
    for (const key of required) {
      if (!(key in config)) {
        return { valid: false, error: `Missing required config field: ${key}` };
      }
    }
  }

  if (properties) {
    for (const [key, def] of Object.entries(properties)) {
      if (key in config && def.type) {
        const actual = typeof config[key];
        const expected = def.type === 'array' ? 'object' : def.type;
        if (actual !== expected && !(def.type === 'array' && Array.isArray(config[key]))) {
          return { valid: false, error: `Config field '${key}': expected ${def.type}, got ${actual}` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Checks that the caller has all permissions required by the plugin.
 */
export function checkPermissions(
  callerPermissions: string[],
  requiredPermissions: string[],
): { allowed: true } | { allowed: false; missing: string[] } {
  const missing = requiredPermissions.filter(p => !callerPermissions.includes(p));
  return missing.length === 0
    ? { allowed: true }
    : { allowed: false, missing };
}
```

- [ ] **Step 2: Write unit test**

Create `src/modules/plugins/__tests__/plugins.manifest-validator.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { validatePluginConfig, checkPermissions } from '../plugins.manifest-validator';

describe('validatePluginConfig', () => {
  it('returns valid when no schema provided', () => {
    expect(validatePluginConfig({}, undefined)).toEqual({ valid: true });
  });

  it('fails when required field missing', () => {
    const schema = { required: ['apiUrl'], properties: { apiUrl: { type: 'string' } } };
    const result = validatePluginConfig({}, schema);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('apiUrl');
  });

  it('fails on type mismatch', () => {
    const schema = { properties: { port: { type: 'number' } } };
    const result = validatePluginConfig({ port: 'not-a-number' }, schema);
    expect(result.valid).toBe(false);
  });

  it('passes when config matches schema', () => {
    const schema = { required: ['apiUrl'], properties: { apiUrl: { type: 'string' }, port: { type: 'number' } } };
    expect(validatePluginConfig({ apiUrl: 'https://example.com', port: 443 }, schema)).toEqual({ valid: true });
  });
});

describe('checkPermissions', () => {
  it('allows when caller has all required permissions', () => {
    expect(checkPermissions(['workspace:read', 'erp:read'], ['workspace:read'])).toEqual({ allowed: true });
  });

  it('denies and returns missing permissions', () => {
    const result = checkPermissions(['workspace:read'], ['workspace:read', 'erp:write']);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.missing).toContain('erp:write');
  });
});
```

- [ ] **Step 3: Run the test**

```bash
bun --env-file .env.test test src/modules/plugins/__tests__/plugins.manifest-validator.test.ts
```

Expected: 5 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/modules/plugins/plugins.manifest-validator.ts src/modules/plugins/__tests__/plugins.manifest-validator.test.ts
git commit -m "feat(plugins): manifest validator + permission checker with tests"
```

---

## Task 8: Plugin Service — Lifecycle Engine

**Files:**
- Create: `src/modules/plugins/plugins.service.ts`

- [ ] **Step 1: Write the service**

```typescript
// src/modules/plugins/plugins.service.ts

import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { logger } from '../../config/logger';
import { pluginCatalogRepo } from './plugins.catalog.repo';
import { pluginInstallationRepo } from './plugins.installation.repo';
import { pluginHealthRepo } from './plugins.health.repo';
import { validatePluginConfig, checkPermissions } from './plugins.manifest-validator';
import { featureFlagsService } from '../feature-flags/feature-flags.service';
import type { InstallationRow, PluginEventRow, HealthCheckRow, Actor, PluginManifestV1 } from './plugins.types';

// Permissions every authenticated caller has by default
const DEFAULT_CALLER_PERMISSIONS = ['workspace:read'];

export const pluginsService = {
  async install(
    workspaceId: string,
    pluginId: string,
    config: Record<string, unknown>,
    actor: Actor,
    callerPermissions: string[] = [],
  ): Promise<Result<InstallationRow>> {
    // 1. Check platform feature flag
    const platformEnabled = await featureFlagsService.isEnabled(workspaceId, 'plugins.platform.enabled');
    if (!platformEnabled) return err(new Error('Plugin platform not enabled for this workspace'));

    // 2. Load catalog entry
    const catalog = await pluginCatalogRepo.findById(pluginId);
    if (!catalog) return err(new Error(`Plugin not found: ${pluginId}`));

    // 3. Block local_sandboxed unless flag set
    if (catalog.kind === 'local_sandboxed') {
      const sandboxEnabled = await featureFlagsService.isEnabled(workspaceId, 'plugins.local_sandboxed.enabled');
      if (!sandboxEnabled) {
        return err(new Error('local_sandboxed plugins are not enabled for this workspace'));
      }
    }

    // 4. Permission check
    const allCallerPerms = [...DEFAULT_CALLER_PERMISSIONS, ...callerPermissions];
    const permCheck = checkPermissions(allCallerPerms, catalog.requiredPermissions as string[]);
    if (!permCheck.allowed) {
      return err(new Error(`Missing permissions: ${permCheck.missing.join(', ')}`));
    }

    // 5. Config validation
    const manifest = catalog.manifest as unknown as PluginManifestV1;
    const configCheck = validatePluginConfig(config, manifest.configSchema);
    if (!configCheck.valid) return err(new Error(configCheck.error));

    // 6. Idempotency — already installed?
    const existing = await pluginInstallationRepo.findByWorkspaceAndPlugin(workspaceId, pluginId);
    if (existing && existing.status === 'active') {
      return err(new Error('Plugin already installed and active'));
    }

    // 7. Create installation row (status: installing)
    const installation = await pluginInstallationRepo.create({ workspaceId, pluginId, config });

    // 8. Run onInstall hook
    try {
      if (manifest.onInstall) await manifest.onInstall(workspaceId, config);
    } catch (hookErr) {
      logger.warn({ pluginId, workspaceId, err: hookErr }, 'Plugin onInstall hook failed — marking failed');
      await pluginInstallationRepo.transition(
        installation.id, workspaceId, 'failed', 'installed', actor,
        { error: hookErr instanceof Error ? hookErr.message : String(hookErr) },
      );
      return err(new Error(`Plugin install hook failed: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`));
    }

    // 9. Transition to active
    const { installation: active } = await pluginInstallationRepo.transition(
      installation.id, workspaceId, 'active', 'installed', actor,
      { pluginId, config },
    );
    return ok(active);
  },

  async enable(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'disabled') return err(new Error(`Cannot enable plugin in status: ${inst.status}`));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'enabled', actor,
    );
    return ok(installation);
  },

  async disable(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active') return err(new Error(`Cannot disable plugin in status: ${inst.status}`));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'disabled', 'disabled', actor,
    );
    return ok(installation);
  },

  async updateConfig(
    workspaceId: string,
    installationId: string,
    config: Record<string, unknown>,
    actor: Actor,
  ): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active') return err(new Error(`Cannot update config in status: ${inst.status}`));

    const catalog = await pluginCatalogRepo.findById(inst.pluginId);
    if (!catalog) return err(new Error('Plugin catalog entry not found'));
    const manifest = catalog.manifest as unknown as PluginManifestV1;
    const configCheck = validatePluginConfig(config, manifest.configSchema);
    if (!configCheck.valid) return err(new Error(configCheck.error));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'config_updated', actor,
      { previousConfig: inst.config, newConfig: config },
      { config },
    );
    return ok(installation);
  },

  async pinVersion(
    workspaceId: string,
    installationId: string,
    version: string,
    actor: Actor,
  ): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active') return err(new Error(`Cannot pin version in status: ${inst.status}`));

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'version_pinned', actor,
      { version, config: inst.config },
      { pinnedVersion: version },
    );
    return ok(installation);
  },

  async uninstall(workspaceId: string, installationId: string, actor: Actor): Promise<Result<void>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'active' && inst.status !== 'disabled') {
      return err(new Error(`Cannot uninstall plugin in status: ${inst.status}`));
    }

    // Transition to uninstalling
    await pluginInstallationRepo.transition(installationId, workspaceId, 'uninstalling', 'uninstalled', actor);

    // Run onUninstall hook
    const catalog = await pluginCatalogRepo.findById(inst.pluginId);
    if (catalog) {
      const manifest = catalog.manifest as unknown as PluginManifestV1;
      try {
        if (manifest.onUninstall) await manifest.onUninstall(workspaceId);
      } catch (hookErr) {
        logger.warn({ installationId, workspaceId, err: hookErr }, 'Plugin onUninstall hook failed — continuing');
      }
    }

    // Transition to uninstalled
    await pluginInstallationRepo.transition(installationId, workspaceId, 'uninstalled', 'uninstalled', actor);
    return ok(undefined);
  },

  async rollback(workspaceId: string, installationId: string, actor: Actor): Promise<Result<InstallationRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    if (inst.status !== 'failed' && inst.status !== 'disabled') {
      return err(new Error(`Cannot rollback plugin in status: ${inst.status}`));
    }

    // Find last version_pinned event for config/version to restore
    const lastPin = await pluginInstallationRepo.getLastVersionPinnedEvent(installationId);
    if (!lastPin) {
      return err(new Error('No pinned version found to rollback to — rollback not possible (409)'));
    }

    await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'rollback_initiated', actor,
      { restoringTo: lastPin.payload },
    );

    const { installation } = await pluginInstallationRepo.transition(
      installationId, workspaceId, 'active', 'rollback_completed', actor,
      { restoredVersion: lastPin.payload },
      {
        config: (lastPin.payload.config as Record<string, unknown>) ?? inst.config,
        pinnedVersion: lastPin.payload.version as string ?? inst.pinnedVersion ?? undefined,
      },
    );
    return ok(installation);
  },

  async runHealthCheck(workspaceId: string, installationId: string): Promise<Result<HealthCheckRow>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));

    const catalog = await pluginCatalogRepo.findById(inst.pluginId);
    const manifest = catalog?.manifest as unknown as PluginManifestV1 | undefined;
    const healthUrl = manifest?.healthCheckUrl;

    let status: 'healthy' | 'degraded' | 'unreachable' = 'unreachable';
    let latencyMs: number | undefined;
    let error: string | undefined;

    if (healthUrl) {
      const start = performance.now();
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        latencyMs = Math.round(performance.now() - start);
        const body = await res.json() as { status?: string };
        status = body.status === 'ok' ? 'healthy' : 'degraded';
      } catch (fetchErr) {
        latencyMs = Math.round(performance.now() - start);
        error = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        status = 'unreachable';
      }
    } else {
      // No health URL — assume healthy if active
      status = inst.status === 'active' ? 'healthy' : 'degraded';
    }

    const row = await pluginHealthRepo.create({ installationId, status, latencyMs, error });

    // Record health_checked event (doesn't change status)
    await pluginInstallationRepo.transition(
      installationId, workspaceId, inst.status, 'health_checked',
      { id: 'system', type: 'system' },
      { status, latencyMs, error },
    );

    return ok(row);
  },

  async list(workspaceId: string): Promise<InstallationRow[]> {
    return pluginInstallationRepo.findByWorkspace(workspaceId);
  },

  async get(workspaceId: string, installationId: string): Promise<InstallationRow | undefined> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return undefined;
    return inst;
  },

  async getEvents(workspaceId: string, installationId: string): Promise<Result<PluginEventRow[]>> {
    const inst = await pluginInstallationRepo.findById(installationId);
    if (!inst || inst.workspaceId !== workspaceId) return err(new Error('Installation not found'));
    const events = await pluginInstallationRepo.getEvents(installationId);
    return ok(events);
  },
};
```

- [ ] **Step 2: Write unit tests**

Create `src/modules/plugins/__tests__/plugins.service.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ── Mocks ────────────────────────────────────────────────────────────────────
const catalogStore = new Map<string, any>();
const installStore = new Map<string, any>();
const eventStore: any[] = [];

mock.module('../plugins.catalog.repo', () => ({
  pluginCatalogRepo: {
    findById: async (id: string) => catalogStore.get(id),
    findAll: async () => [...catalogStore.values()],
  },
}));

mock.module('../plugins.installation.repo', () => ({
  pluginInstallationRepo: {
    findById: async (id: string) => installStore.get(id),
    findByWorkspaceAndPlugin: async (wsId: string, pluginId: string) =>
      [...installStore.values()].find(i => i.workspaceId === wsId && i.pluginId === pluginId),
    findByWorkspace: async (wsId: string) =>
      [...installStore.values()].filter(i => i.workspaceId === wsId),
    create: async (data: any) => {
      const row = { id: `inst-${Math.random()}`, ...data, status: 'installing', installedAt: new Date(), updatedAt: new Date() };
      installStore.set(row.id, row);
      return row;
    },
    transition: async (id: string, wsId: string, newStatus: string, eventType: string, actor: any, payload = {}, extras = {}) => {
      const inst = installStore.get(id);
      if (!inst) throw new Error('not found');
      Object.assign(inst, { status: newStatus, updatedAt: new Date(), ...extras });
      const event = { id: `evt-${Math.random()}`, installationId: id, workspaceId: wsId, eventType, actorId: actor.id, actorType: actor.type, payload, createdAt: new Date() };
      eventStore.push(event);
      return { installation: inst, event };
    },
    getEvents: async (id: string) => eventStore.filter(e => e.installationId === id),
    getLastVersionPinnedEvent: async (id: string) =>
      [...eventStore].reverse().find(e => e.installationId === id && e.eventType === 'version_pinned'),
  },
}));

mock.module('../plugins.health.repo', () => ({
  pluginHealthRepo: {
    create: async (data: any) => ({ id: 'health-1', ...data, checkedAt: new Date() }),
    getLatest: async () => undefined,
  },
}));

mock.module('../../feature-flags/feature-flags.service', () => ({
  featureFlagsService: {
    isEnabled: async (_wsId: string, flag: string) => {
      if (flag === 'plugins.platform.enabled') return true;
      if (flag === 'plugins.local_sandboxed.enabled') return false;
      return true;
    },
  },
}));

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { pluginsService } = await import('../plugins.service');

const actor = { id: 'user-1', type: 'user' as const };
const wsId = 'ws-test';

const mockManifest = {
  id: 'test-plugin', name: 'Test Plugin', version: '1.0.0',
  kind: 'remote_mcp' as const, description: 'test',
  capabilities: [], requiredPermissions: ['workspace:read'],
};

beforeEach(() => {
  catalogStore.clear();
  installStore.clear();
  eventStore.length = 0;
  catalogStore.set('plugin-1', {
    id: 'plugin-1', name: 'Test Plugin', version: '1.0.0', kind: 'remote_mcp',
    capabilities: [], requiredPermissions: ['workspace:read'],
    manifest: mockManifest,
  });
});

describe('pluginsService', () => {
  it('install creates installation and transitions to active', async () => {
    const result = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('active');
    }
    const events = eventStore.filter(e => e.eventType === 'installed');
    expect(events).toHaveLength(1);
  });

  it('install blocks local_sandboxed when flag off', async () => {
    catalogStore.set('sandbox-1', {
      id: 'sandbox-1', name: 'Sandbox Plugin', version: '1.0.0', kind: 'local_sandboxed',
      capabilities: [], requiredPermissions: ['workspace:read', 'local_sandboxed:run'],
      manifest: { ...mockManifest, kind: 'local_sandboxed' },
    });
    const result = await pluginsService.install(wsId, 'sandbox-1', {}, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('local_sandboxed');
  });

  it('install fails with missing permission', async () => {
    catalogStore.set('restricted-1', {
      id: 'restricted-1', name: 'Restricted Plugin', version: '1.0.0', kind: 'remote_mcp',
      capabilities: [], requiredPermissions: ['erp:write'],
      manifest: { ...mockManifest, requiredPermissions: ['erp:write'] },
    });
    const result = await pluginsService.install(wsId, 'restricted-1', {}, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('erp:write');
  });

  it('disable transitions active → disabled', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;

    const disable = await pluginsService.disable(wsId, install.value.id, actor);
    expect(disable.ok).toBe(true);
    if (disable.ok) expect(disable.value.status).toBe('disabled');
  });

  it('enable transitions disabled → active', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    await pluginsService.disable(wsId, install.value.id, actor);

    const enable = await pluginsService.enable(wsId, install.value.id, actor);
    expect(enable.ok).toBe(true);
    if (enable.ok) expect(enable.value.status).toBe('active');
  });

  it('rollback fails when no pinned version exists', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;
    // Force to disabled state
    installStore.get(install.value.id).status = 'disabled';

    const rollback = await pluginsService.rollback(wsId, install.value.id, actor);
    expect(rollback.ok).toBe(false);
    if (!rollback.ok) expect(rollback.error.message).toContain('No pinned version');
  });

  it('rollback succeeds after pinning a version', async () => {
    const install = await pluginsService.install(wsId, 'plugin-1', {}, actor);
    expect(install.ok).toBe(true);
    if (!install.ok) return;

    await pluginsService.pinVersion(wsId, install.value.id, '1.0.0', actor);
    installStore.get(install.value.id).status = 'disabled';

    const rollback = await pluginsService.rollback(wsId, install.value.id, actor);
    expect(rollback.ok).toBe(true);
    if (rollback.ok) expect(rollback.value.status).toBe('active');
  });
});
```

- [ ] **Step 3: Run unit tests**

```bash
bun --env-file .env.test test src/modules/plugins/__tests__/plugins.service.test.ts
```

Expected: 7 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/modules/plugins/plugins.service.ts src/modules/plugins/__tests__/plugins.service.test.ts
git commit -m "feat(plugins): plugin lifecycle service with unit tests"
```

---

## Task 9: Zod Schemas

**Files:**
- Create: `src/modules/plugins/plugins.schemas.ts`

- [ ] **Step 1: Write schemas**

```typescript
// src/modules/plugins/plugins.schemas.ts

import { z } from 'zod';

export const installPluginSchema = z.object({
  pluginId: z.string().uuid(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const updateConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

export const pinVersionSchema = z.object({
  version: z.string().min(1),
});

export const installationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const pluginIdParamSchema = z.object({
  id: z.string().uuid(),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/plugins/plugins.schemas.ts
git commit -m "feat(plugins): plugin API Zod schemas"
```

---

## Task 10: Catalog Routes

**Files:**
- Create: `src/modules/plugins/plugins.catalog.routes.ts`

- [ ] **Step 1: Write catalog routes**

```typescript
// src/modules/plugins/plugins.catalog.routes.ts

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { pluginCatalogRepo } from './plugins.catalog.repo';
import { pluginIdParamSchema } from './plugins.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const listRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'Plugin catalog list', ...jsonRes } },
});

const getRoute = createRoute({
  method: 'get', path: '/{id}',
  request: { params: pluginIdParamSchema },
  responses: { 200: { description: 'Plugin details', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } },
});

export const pluginCatalogRoutes = new OpenAPIHono();

pluginCatalogRoutes.openapi(listRoute, async (c) => {
  const plugins = await pluginCatalogRepo.findAll();
  return c.json(plugins);
});

pluginCatalogRoutes.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');
  const plugin = await pluginCatalogRepo.findById(id);
  if (!plugin) return c.json({ error: 'Plugin not found' }, 404);
  return c.json(plugin);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/plugins/plugins.catalog.routes.ts
git commit -m "feat(plugins): plugin catalog routes (GET /plugin-catalog)"
```

---

## Task 11: Workspace Plugin Routes

**Files:**
- Create: `src/modules/plugins/plugins.routes.ts`

- [ ] **Step 1: Write workspace plugin routes**

```typescript
// src/modules/plugins/plugins.routes.ts

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { pluginsService } from './plugins.service';
import { installPluginSchema, updateConfigSchema, pinVersionSchema, installationIdParamSchema } from './plugins.schemas';
import type { Actor } from './plugins.types';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const idParam = { request: { params: installationIdParamSchema } };

const installRoute = createRoute({ method: 'post', path: '/install', request: { body: { content: { 'application/json': { schema: installPluginSchema } } } }, responses: { 201: { description: 'Installed', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const listRoute = createRoute({ method: 'get', path: '/', responses: { 200: { description: 'Installations', ...jsonRes } } });
const getRoute = createRoute({ method: 'get', path: '/{id}', ...idParam, responses: { 200: { description: 'Installation', ...jsonRes }, 404: { description: 'Not found', ...jsonRes } } });
const configRoute = createRoute({ method: 'patch', path: '/{id}/config', ...idParam, request: { body: { content: { 'application/json': { schema: updateConfigSchema } } } }, responses: { 200: { description: 'Updated', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const enableRoute = createRoute({ method: 'post', path: '/{id}/enable', ...idParam, responses: { 200: { description: 'Enabled', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const disableRoute = createRoute({ method: 'post', path: '/{id}/disable', ...idParam, responses: { 200: { description: 'Disabled', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const pinRoute = createRoute({ method: 'post', path: '/{id}/pin', ...idParam, request: { body: { content: { 'application/json': { schema: pinVersionSchema } } } }, responses: { 200: { description: 'Pinned', ...jsonRes }, 400: { description: 'Error', ...jsonRes } } });
const uninstallRoute = createRoute({ method: 'post', path: '/{id}/uninstall', ...idParam, responses: { 204: { description: 'Uninstalled' }, 400: { description: 'Error', ...jsonRes } } });
const rollbackRoute = createRoute({ method: 'post', path: '/{id}/rollback', ...idParam, responses: { 200: { description: 'Rolled back', ...jsonRes }, 400: { description: 'Error', ...jsonRes }, 409: { description: 'No prior version', ...jsonRes } } });
const eventsRoute = createRoute({ method: 'get', path: '/{id}/events', ...idParam, responses: { 200: { description: 'Events', ...jsonRes } } });
const healthRoute = createRoute({ method: 'get', path: '/{id}/health', ...idParam, responses: { 200: { description: 'Health', ...jsonRes } } });
const healthRunRoute = createRoute({ method: 'post', path: '/{id}/health/run', ...idParam, responses: { 200: { description: 'Health checked', ...jsonRes } } });

export const pluginRoutes = new OpenAPIHono();

function getActor(c: any): Actor {
  return { id: c.get('userId') as string ?? 'system', type: 'user' };
}

pluginRoutes.openapi(installRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { pluginId, config } = c.req.valid('json');
  const result = await pluginsService.install(workspaceId, pluginId, config, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value, 201);
});

pluginRoutes.openapi(listRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  return c.json(await pluginsService.list(workspaceId));
});

pluginRoutes.openapi(getRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const inst = await pluginsService.get(workspaceId, id);
  if (!inst) return c.json({ error: 'Not found' }, 404);
  return c.json(inst);
});

pluginRoutes.openapi(configRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const { config } = c.req.valid('json');
  const result = await pluginsService.updateConfig(workspaceId, id, config, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(enableRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.enable(workspaceId, id, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(disableRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.disable(workspaceId, id, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(pinRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const { version } = c.req.valid('json');
  const result = await pluginsService.pinVersion(workspaceId, id, version, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});

pluginRoutes.openapi(uninstallRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.uninstall(workspaceId, id, getActor(c));
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.body(null, 204);
});

pluginRoutes.openapi(rollbackRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.rollback(workspaceId, id, getActor(c));
  if (!result.ok) {
    const status = result.error.message.includes('409') ? 409 : 400;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value);
});

pluginRoutes.openapi(eventsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.getEvents(workspaceId, id);
  if (!result.ok) return c.json({ error: result.error.message }, 404);
  return c.json(result.value);
});

pluginRoutes.openapi(healthRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const inst = await pluginsService.get(workspaceId, id);
  if (!inst) return c.json({ error: 'Not found' }, 404);
  const { pluginHealthRepo } = await import('./plugins.health.repo');
  const health = await pluginHealthRepo.getLatest(id);
  return c.json(health ?? { status: 'unknown' });
});

pluginRoutes.openapi(healthRunRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  const result = await pluginsService.runHealthCheck(workspaceId, id);
  if (!result.ok) return c.json({ error: result.error.message }, 400);
  return c.json(result.value);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/plugins/plugins.routes.ts
git commit -m "feat(plugins): workspace plugin lifecycle routes"
```

---

## Task 12: Wire Routes into App

**Files:**
- Modify: `src/api/routes/workspace/index.ts`
- Modify: `src/app/create-app.ts`

- [ ] **Step 1: Add plugin routes to workspace router**

In `src/api/routes/workspace/index.ts`, add:

```typescript
// Add import after the last import line:
import { pluginRoutes } from '../../../modules/plugins/plugins.routes';

// Add mount after the last workspaceRoutes.route() call:
workspaceRoutes.route('/plugins', pluginRoutes);
```

- [ ] **Step 2: Add catalog routes to app**

In `src/app/create-app.ts`, find where `publicRoutes` is mounted and add catalog routes below it. First add the import:

```typescript
import { pluginCatalogRoutes } from '../modules/plugins/plugins.catalog.routes';
```

Then in the app setup (after public routes are mounted):

```typescript
app.route('/api/v1/plugin-catalog', pluginCatalogRoutes);
```

- [ ] **Step 3: Run the full unit test suite**

```bash
bun --env-file .env.test test src/
```

Expected: all existing tests + new plugin tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/workspace/index.ts src/app/create-app.ts
git commit -m "feat(plugins): wire plugin routes into app (workspace + catalog)"
```

---

## Task 13: Integration Tests

**Files:**
- Create: `tests/integration/plugins.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/integration/plugins.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables } from './helpers';
import { testDb } from './helpers/db';
import { pluginCatalog } from '../../src/infra/db/schema';

describe('Plugin Platform', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let catalogPluginId: string;
  let installationId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Plugin Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    // Seed a plugin into catalog
    const [row] = await testDb.insert(pluginCatalog).values({
      name: 'test-remote-mcp',
      version: '1.0.0',
      kind: 'remote_mcp',
      capabilities: [{ id: 'mcp_tool' }],
      requiredPermissions: ['workspace:read'],
      manifest: {
        id: 'test-remote-mcp', name: 'Test MCP Plugin', version: '1.0.0',
        kind: 'remote_mcp', description: 'Integration test plugin',
        capabilities: [], requiredPermissions: ['workspace:read'],
      },
    }).returning({ id: pluginCatalog.id });
    catalogPluginId = row!.id;

    // Enable plugin platform for this workspace
    await app.request(`/api/v1/workspaces/${workspaceId}/feature-flags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId, 'admin') },
      body: JSON.stringify({ flag: 'plugins.platform.enabled', value: true }),
    });
  });

  afterAll(async () => {
    await truncateTables('plugin_health_checks', 'plugin_events', 'plugin_installations', 'plugin_catalog', 'workspace_members', 'workspaces', 'users');
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/plugins`;
  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET /plugin-catalog returns catalog list', async () => {
    const res = await app.request('/api/v1/plugin-catalog', { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((p: any) => p.id === catalogPluginId)).toBe(true);
  });

  it('POST /plugins/install creates installation (status: active)', async () => {
    const res = await app.request(`${base()}/install`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ pluginId: catalogPluginId, config: {} }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
    installationId = body.id;
    expect(typeof installationId).toBe('string');
  });

  it('GET /plugins lists installed plugins', async () => {
    const res = await app.request(base(), { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((i: any) => i.id === installationId)).toBe(true);
  });

  it('GET /plugins/:id returns installation', async () => {
    const res = await app.request(`${base()}/${installationId}`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(installationId);
  });

  it('POST /plugins/:id/disable → disabled', async () => {
    const res = await app.request(`${base()}/${installationId}/disable`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('disabled');
  });

  it('POST /plugins/:id/enable → active', async () => {
    const res = await app.request(`${base()}/${installationId}/enable`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
  });

  it('POST /plugins/:id/pin → version pinned', async () => {
    const res = await app.request(`${base()}/${installationId}/pin`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ version: '1.0.0' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pinnedVersion).toBe('1.0.0');
  });

  it('GET /plugins/:id/events returns event log', async () => {
    const res = await app.request(`${base()}/${installationId}/events`, { headers: hdrs() });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    // Should have: installed, disabled, enabled, version_pinned
    expect(body.length).toBeGreaterThanOrEqual(3);
  });

  it('POST /plugins/:id/rollback restores pinned version', async () => {
    // Disable to put into rollback-eligible state
    await app.request(`${base()}/${installationId}/disable`, { method: 'POST', headers: hdrs() });
    const res = await app.request(`${base()}/${installationId}/rollback`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
  });

  it('POST /plugins/:id/uninstall → 204', async () => {
    const res = await app.request(`${base()}/${installationId}/uninstall`, {
      method: 'POST', headers: hdrs(),
    });
    expect(res.status).toBe(204);
  });

  it('cross-workspace access rejected', async () => {
    const other = await seedWorkspace({ name: 'Other WS' });
    const res = await app.request(`/api/v1/workspaces/${other.workspaceId}/plugins/${installationId}`, {
      headers: { ...authHeader(other.userId, 'admin') },
    });
    expect([404, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
bun --env-file .env.test test tests/integration/plugins.test.ts
```

Expected: 11 pass, 0 fail.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
bun --env-file .env.test test tests/integration/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/plugins.test.ts
git commit -m "test(plugins): E2E integration tests for plugin lifecycle"
```

---

## Self-Review Checklist

- [x] All spec section 2 requirements have tasks
- [x] No TBDs or placeholders in code
- [x] Type names consistent across all tasks (InstallationRow, PluginEventRow, Actor)
- [x] `transition()` is the only way to change status — enforced by repo design
- [x] Both `plugin_events` and `audit_logs` written in same transaction (Task 5)
- [x] Feature flag guard in service (Task 8)
- [x] Rollback 409 condition documented and tested (Task 8)
- [x] Integration test covers cross-workspace isolation (Task 13)
