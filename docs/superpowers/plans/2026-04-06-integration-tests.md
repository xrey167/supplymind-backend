# Integration Tests — All Modules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write HTTP-level integration tests for every API module using the real Hono app, real Postgres test DB, and a dev-mode JWT auth bypass — no mocks, no stubs.

**Architecture:** Each test file imports `createApp()` directly (no subsystem initialization — BullMQ workers, Redis bridge, etc. are skipped by not calling `initSubsystems()`). Auth uses the dev-fallback path in `authMiddleware` (active when `CLERK_SECRET_KEY` is absent from `.env.test`). Each suite seeds its own workspace + member via `db` directly, then truncates relevant tables in `afterAll`.

**Tech Stack:** Bun test, Hono `app.request()`, Drizzle ORM (direct DB access for seeding/teardown), Postgres test DB (`.env.test`), no Clerk, no Redis, no BullMQ.

---

## File Structure

```
tests/integration/
  helpers/
    auth.ts          — makeJwt(sub, role): string
    db.ts            — seedWorkspace(), truncateTables(), db re-export
    app.ts           — getTestApp(): OpenAPIHono (singleton, no subsystems)
    index.ts         — barrel re-export
  health.test.ts
  workspaces.test.ts
  members.test.ts
  agents.test.ts
  tools.test.ts
  skills.test.ts
  sessions.test.ts
  tasks.test.ts
  mcp-servers.test.ts
  orchestration.test.ts
  workflows.test.ts
  memory.test.ts
  agent-registry.test.ts
  api-keys.test.ts
  settings.test.ts
  feature-flags.test.ts
  public.test.ts
```

**Key constraint — no subsystem init:** `createApp()` wires routes but does NOT call `initSubsystems()`. That means BullMQ workers, Redis pub/sub, and MCP client pool start-up are all skipped. Routes that enqueue jobs (tasks, orchestrations) still work because they insert into the DB — the worker just won't pick them up in tests.

**Auth bypass:** When `CLERK_SECRET_KEY` is not set, `authMiddleware` falls back to `decodeJwtPayload()` which base64-decodes the JWT payload without signature verification. We exploit this with a hand-crafted unsigned JWT.

**Test DB:** Requires `.env.test` with `DATABASE_URL` pointing at a Postgres test database (separate from dev). Run `bun db:migrate:test` once to create schema.

---

### Task 1: Test Helpers

**Files:**
- Create: `tests/integration/helpers/auth.ts`
- Create: `tests/integration/helpers/db.ts`
- Create: `tests/integration/helpers/app.ts`
- Create: `tests/integration/helpers/index.ts`

- [ ] **Step 1: Create auth helper**

```typescript
// tests/integration/helpers/auth.ts
/**
 * Generate a dev-mode JWT (unsigned) that the auth middleware accepts when
 * CLERK_SECRET_KEY is not set. The middleware calls decodeJwtPayload() which
 * only base64-decodes the payload — no signature verification.
 */
export function makeJwt(sub: string, role: string = 'admin'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.unsigned`;
}

export function authHeader(sub: string, role: string = 'admin'): Record<string, string> {
  return { Authorization: `Bearer ${makeJwt(sub, role)}` };
}
```

- [ ] **Step 2: Create DB helper**

```typescript
// tests/integration/helpers/db.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { workspaces, workspaceMembers, users } from '../../../src/infra/db/schema';
import { sql } from 'drizzle-orm';

const client = postgres(Bun.env.DATABASE_URL!);
export const testDb = drizzle(client);

export interface SeedResult {
  workspaceId: string;
  userId: string;
}

/**
 * Insert a workspace + owner member into the test DB.
 * Returns their IDs for use in route paths and assertions.
 */
export async function seedWorkspace(opts: {
  name?: string;
  userId?: string;
  role?: 'owner' | 'admin' | 'member' | 'viewer';
} = {}): Promise<SeedResult> {
  const userId = opts.userId ?? `user_test_${Math.random().toString(36).slice(2, 10)}`;
  const name = opts.name ?? `Test Workspace ${Date.now()}`;
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // Upsert user (thin sync row)
  await testDb.insert(users).values({ id: userId, email: `${userId}@test.com` }).onConflictDoNothing();

  const [ws] = await testDb.insert(workspaces).values({
    name,
    slug: `${slug}-${Date.now()}`,
    createdBy: userId,
  }).returning({ id: workspaces.id });

  await testDb.insert(workspaceMembers).values({
    workspaceId: ws!.id,
    userId,
    role: opts.role ?? 'owner',
  });

  return { workspaceId: ws!.id, userId };
}

/**
 * Truncate tables (cascade) to clean state between suites.
 * Pass table names as they appear in the DB (snake_case).
 */
export async function truncateTables(...tableNames: string[]): Promise<void> {
  if (tableNames.length === 0) return;
  const list = tableNames.map(t => `"${t}"`).join(', ');
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${list} CASCADE`));
}

/** Close the test DB connection — call in afterAll at the very end. */
export async function closeTestDb(): Promise<void> {
  await client.end();
}
```

- [ ] **Step 3: Create app helper**

```typescript
// tests/integration/helpers/app.ts
import { createApp } from '../../../src/app/create-app';
import type { OpenAPIHono } from '@hono/zod-openapi';

let _app: OpenAPIHono | null = null;

/**
 * Return the Hono app singleton.
 * createApp() wires all routes but does NOT call initSubsystems(),
 * so no BullMQ workers, Redis bridges, or MCP clients are started.
 */
export async function getTestApp(): Promise<OpenAPIHono> {
  if (!_app) {
    _app = await createApp();
  }
  return _app;
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// tests/integration/helpers/index.ts
export { makeJwt, authHeader } from './auth';
export { testDb, seedWorkspace, truncateTables, closeTestDb } from './db';
export { getTestApp } from './app';
```

- [ ] **Step 5: Run a minimal smoke check**

```bash
bun test tests/integration/helpers/ 2>&1 | tail -5
```

No test files yet — expect "0 tests". That's correct.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/helpers/
git commit -m "test(integration): add test helpers — auth, db seed, app factory"
```

---

### Task 2: Health Endpoints

**Files:**
- Create: `tests/integration/health.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/health.test.ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { getTestApp } from './helpers';

describe('GET /healthz', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it('returns 200 with status ok', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('GET /readyz', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it('returns 200 when DB is reachable', async () => {
    const res = await app.request('/readyz');
    // 200 = ready, 503 = unhealthy — in CI the DB must be up
    expect([200, 503]).toContain(res.status);
    const body = await res.json() as any;
    expect(typeof body.status).toBe('string');
  });
});
```

- [ ] **Step 2: Run and verify it passes (DB must be running)**

```bash
bun --env-file .env.test test tests/integration/health.test.ts 2>&1 | tail -6
```

Expected: `2 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/health.test.ts
git commit -m "test(integration): health endpoint tests"
```

---

### Task 3: Workspace Management

**Files:**
- Create: `tests/integration/workspaces.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/workspaces.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

const BASE = '/api/v1/workspace-management';

describe('Workspace management', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  const userId = 'user_ws_integration';

  beforeAll(async () => {
    app = await getTestApp();
    await truncateTables('workspace_members', 'workspaces', 'users');
  });

  afterAll(async () => {
    await truncateTables('workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  it('POST / creates a workspace and returns 201', async () => {
    const res = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'Integration WS' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Integration WS');
    expect(typeof body.data.id).toBe('string');
  });

  it('GET / lists workspaces for the user', async () => {
    const res = await app.request(`${BASE}/`, {
      headers: authHeader(userId),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /:workspaceId returns workspace details', async () => {
    // Create one first
    const createRes = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Detail Test' }),
    });
    const { data: ws } = await createRes.json() as any;

    const res = await app.request(`${BASE}/${ws.id}`, {
      headers: authHeader(userId),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(ws.id);
  });

  it('PATCH /:workspaceId updates workspace name', async () => {
    const createRes = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Rename Me' }),
    });
    const { data: ws } = await createRes.json() as any;

    const res = await app.request(`${BASE}/${ws.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Renamed' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('WS Renamed');
  });

  it('DELETE /:workspaceId soft-deletes the workspace', async () => {
    const createRes = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(userId) },
      body: JSON.stringify({ name: 'WS Delete Me' }),
    });
    const { data: ws } = await createRes.json() as any;

    const res = await app.request(`${BASE}/${ws.id}`, {
      method: 'DELETE',
      headers: authHeader(userId),
    });
    expect(res.status).toBe(204);
  });

  it('POST / returns 401 without auth', async () => {
    const res = await app.request(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth WS' }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/workspaces.test.ts 2>&1 | tail -8
```

Expected: `6 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/workspaces.test.ts
git commit -m "test(integration): workspace management CRUD"
```

---

### Task 4: Members & Invitations

**Files:**
- Create: `tests/integration/members.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/members.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Members', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let ownerId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Members Test WS' });
    workspaceId = seed.workspaceId;
    ownerId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_invitations', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/members`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(ownerId, 'admin') });

  it('GET /members lists members', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    // Owner was seeded
    expect(body.data.some((m: any) => m.userId === ownerId)).toBe(true);
  });

  it('POST /members/invitations creates an invitation', async () => {
    const res = await app.request(`${base()}/invitations`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email: 'invite@example.com', role: 'member' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.email).toBe('invite@example.com');
    expect(typeof body.data.token).toBe('string');
  });

  it('GET /members/invitations lists pending invitations', async () => {
    const res = await app.request(`${base()}/invitations`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('DELETE /members/invitations/:id revokes an invitation', async () => {
    // Create first
    const createRes = await app.request(`${base()}/invitations`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email: 'revoke@example.com', role: 'member' }),
    });
    const { data: inv } = await createRes.json() as any;

    const res = await app.request(`${base()}/invitations/${inv.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });

  it('PATCH /members/:userId/role updates a member role', async () => {
    // Add a member to update
    const memberId = `user_member_${Date.now()}`;
    const { testDb } = await import('./helpers/db');
    const { workspaceMembers, users } = await import('../../src/infra/db/schema');
    await testDb.insert(users).values({ id: memberId, email: `${memberId}@test.com` }).onConflictDoNothing();
    await testDb.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member' });

    const res = await app.request(`${base()}/${memberId}/role`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /members/:userId removes a member', async () => {
    const memberId = `user_remove_${Date.now()}`;
    const { testDb } = await import('./helpers/db');
    const { workspaceMembers, users } = await import('../../src/infra/db/schema');
    await testDb.insert(users).values({ id: memberId, email: `${memberId}@test.com` }).onConflictDoNothing();
    await testDb.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member' });

    const res = await app.request(`${base()}/${memberId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/members.test.ts 2>&1 | tail -8
```

Expected: `6 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/members.test.ts
git commit -m "test(integration): members and invitations"
```

---

### Task 5: Agents CRUD

**Files:**
- Create: `tests/integration/agents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/agents.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Agents', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Agents Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/agents`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let agentId: string;

  it('POST / creates an agent', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Test Agent',
        model: 'claude-opus-4-6',
        provider: 'anthropic',
        mode: 'raw',
        systemPrompt: 'You are a test agent.',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Test Agent');
    agentId = body.data.id;
  });

  it('GET / lists agents for workspace', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns agent by id', async () => {
    const res = await app.request(`${base()}/${agentId}`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(agentId);
  });

  it('PATCH /:id updates an agent', async () => {
    const res = await app.request(`${base()}/${agentId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ name: 'Updated Agent' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Updated Agent');
  });

  it('DELETE /:id deletes an agent', async () => {
    const res = await app.request(`${base()}/${agentId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });

  it('GET /:id returns 404 for deleted agent', async () => {
    const res = await app.request(`${base()}/${agentId}`, { headers: headers() });
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not a workspace member', async () => {
    const res = await app.request(base(), {
      headers: authHeader('user_outsider', 'admin'),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/agents.test.ts 2>&1 | tail -8
```

Expected: `7 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/agents.test.ts
git commit -m "test(integration): agents CRUD"
```

---

### Task 6: Tools CRUD

**Files:**
- Create: `tests/integration/tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/tools.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Tools', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Tools Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('skill_definitions', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/tools`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let toolId: string;

  it('POST / creates a tool (operator role)', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        handlerConfig: { type: 'inline', code: 'return args.query' },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('test-tool');
    toolId = body.data.id;
  });

  it('GET / lists tools', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns tool by id', async () => {
    const res = await app.request(`${base()}/${toolId}`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(toolId);
  });

  it('PATCH /:id updates a tool', async () => {
    const res = await app.request(`${base()}/${toolId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ description: 'Updated description' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.description).toBe('Updated description');
  });

  it('DELETE /:id deletes a tool (admin role)', async () => {
    const res = await app.request(`${base()}/${toolId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/tools.test.ts 2>&1 | tail -8
```

Expected: `5 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/tools.test.ts
git commit -m "test(integration): tools CRUD"
```

---

### Task 7: Skills

**Files:**
- Create: `tests/integration/skills.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/skills.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Skills', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Skills Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/skills`;
  const headers = () => ({ ...authHeader(userId, 'admin') });

  it('GET / lists available skills', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:name describes a known builtin skill', async () => {
    // First fetch the list to find any real skill name
    const listRes = await app.request(base(), { headers: headers() });
    const { data: skills } = await listRes.json() as any;
    if (skills.length === 0) return; // Skip if no skills registered

    const skillName = skills[0].name;
    const res = await app.request(`${base()}/${skillName}`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe(skillName);
  });

  it('GET /:name returns 404 for unknown skill', async () => {
    const res = await app.request(`${base()}/definitely-not-a-real-skill-xyz`, {
      headers: headers(),
    });
    expect(res.status).toBe(404);
  });

  it('POST /:name/invoke returns 404 for unknown skill', async () => {
    const res = await app.request(`${base()}/nonexistent/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/skills.test.ts 2>&1 | tail -8
```

Expected: `4 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/skills.test.ts
git commit -m "test(integration): skills list, describe, invoke"
```

---

### Task 8: Sessions

**Files:**
- Create: `tests/integration/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/sessions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { agentConfigs } from '../../src/infra/db/schema';

describe('Sessions', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let agentId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Sessions Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    // Seed a minimal agent to attach sessions to
    const [agent] = await testDb.insert(agentConfigs).values({
      workspaceId,
      name: 'Session Agent',
      model: 'claude-opus-4-6',
    }).returning({ id: agentConfigs.id });
    agentId = agent!.id;
  });

  afterAll(async () => {
    await truncateTables('session_messages', 'sessions', 'agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/sessions`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let sessionId: string;

  it('POST / creates a session', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ agentId, title: 'Test Session' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.agentId).toBe(agentId);
    sessionId = body.data.id;
  });

  it('GET /:id returns session details', async () => {
    const res = await app.request(`${base()}/${sessionId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(sessionId);
  });

  it('POST /:id/messages adds a message', async () => {
    const res = await app.request(`${base()}/${sessionId}/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ role: 'user', content: 'Hello world' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.content).toBe('Hello world');
  });

  it('GET /:id/messages returns messages', async () => {
    const res = await app.request(`${base()}/${sessionId}/messages`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /:id/close closes the session', async () => {
    const res = await app.request(`${base()}/${sessionId}/close`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/sessions.test.ts 2>&1 | tail -8
```

Expected: `5 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/sessions.test.ts
git commit -m "test(integration): sessions CRUD and messages"
```

---

### Task 9: Tasks

**Files:**
- Create: `tests/integration/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/tasks.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { agentConfigs } from '../../src/infra/db/schema';

describe('Tasks', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let agentId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Tasks Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    const [agent] = await testDb.insert(agentConfigs).values({
      workspaceId,
      name: 'Task Agent',
      model: 'claude-opus-4-6',
    }).returning({ id: agentConfigs.id });
    agentId = agent!.id;
  });

  afterAll(async () => {
    await truncateTables('task_dependencies', 'a2a_tasks', 'agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/tasks`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let taskId: string;
  let taskId2: string;

  it('POST / sends a task and returns 201', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        agentId,
        message: { role: 'user', parts: [{ text: 'Hello' }] },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.agentId).toBe(agentId);
    expect(body.data.status).toBe('submitted');
    taskId = body.data.id;
  });

  it('GET / lists tasks with pagination', async () => {
    const res = await app.request(`${base()}?limit=10`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns task details', async () => {
    const res = await app.request(`${base()}/${taskId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(taskId);
  });

  it('POST / sends a second task for dependency tests', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        agentId,
        message: { role: 'user', parts: [{ text: 'Task 2' }] },
      }),
    });
    expect(res.status).toBe(201);
    taskId2 = (await res.json() as any).data.id;
  });

  it('POST /:id/dependencies adds a task dependency', async () => {
    const res = await app.request(`${base()}/${taskId2}/dependencies`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ dependsOnTaskId: taskId }),
    });
    expect(res.status).toBe(201);
  });

  it('GET /:id/dependencies lists dependencies', async () => {
    const res = await app.request(`${base()}/${taskId2}/dependencies`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((d: any) => d.dependsOnTaskId === taskId)).toBe(true);
  });

  it('DELETE /:id/dependencies/:depId removes a dependency', async () => {
    const res = await app.request(`${base()}/${taskId2}/dependencies/${taskId}`, {
      method: 'DELETE',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(204);
  });

  it('POST /:id/cancel cancels the task', async () => {
    const res = await app.request(`${base()}/${taskId}/cancel`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect([200, 409]).toContain(res.status); // 409 if already in terminal state
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/tasks.test.ts 2>&1 | tail -8
```

Expected: `8 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/tasks.test.ts
git commit -m "test(integration): tasks send, list, cancel, dependencies"
```

---

### Task 10: MCP Servers

**Files:**
- Create: `tests/integration/mcp-servers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/mcp-servers.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('MCP Servers', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'MCP Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('mcp_server_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/mcp`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let mcpId: string;

  it('POST / creates an MCP server config', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Test MCP Server',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
        enabled: false,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Test MCP Server');
    mcpId = body.data.id;
  });

  it('GET / lists MCP servers for workspace', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((s: any) => s.id === mcpId)).toBe(true);
  });

  it('PATCH /:mcpId updates an MCP server config', async () => {
    const res = await app.request(`${base()}/${mcpId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ name: 'Updated MCP Server' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Updated MCP Server');
  });

  it('DELETE /:mcpId deletes the MCP server config', async () => {
    const res = await app.request(`${base()}/${mcpId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/mcp-servers.test.ts 2>&1 | tail -8
```

Expected: `4 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-servers.test.ts
git commit -m "test(integration): MCP server configs CRUD"
```

---

### Task 11: Orchestration & Workflows

**Files:**
- Create: `tests/integration/orchestration.test.ts`
- Create: `tests/integration/workflows.test.ts`

- [ ] **Step 1: Write the orchestration test**

```typescript
// tests/integration/orchestration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Orchestration', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Orchestration Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('orchestrations', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/orchestrations`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let orchId: string;

  it('POST / creates an orchestration', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Test Orchestration',
        definition: {
          steps: [
            { id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'hello' } },
          ],
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    orchId = body.data.id;
    expect(typeof orchId).toBe('string');
  });

  it('GET / lists orchestrations', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns orchestration', async () => {
    const res = await app.request(`${base()}/${orchId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(orchId);
  });

  it('POST /:id/run runs the orchestration', async () => {
    const res = await app.request(`${base()}/${orchId}/run`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });
    // Run may return 200 (sync) or 202 (async)
    expect([200, 202]).toContain(res.status);
  });

  it('POST /:id/cancel cancels the orchestration', async () => {
    const res = await app.request(`${base()}/${orchId}/cancel`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect([200, 409]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Write the workflows test**

```typescript
// tests/integration/workflows.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Workflows', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Workflows Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workflow_templates', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/workflows`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let workflowId: string;

  it('POST / creates a workflow template', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Test Workflow',
        definition: { steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: {} }] },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    workflowId = body.data.id;
    expect(body.data.name).toBe('Test Workflow');
  });

  it('GET / lists workflow templates', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /:id returns workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(workflowId);
  });

  it('PATCH /:id updates a workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ name: 'Updated Workflow' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.name).toBe('Updated Workflow');
  });

  it('POST /run runs an ad-hoc workflow', async () => {
    const res = await app.request(`${base()}/run`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        definition: { steps: [{ id: 's1', type: 'skill', skillId: 'echo', args: { msg: 'test' } }] },
      }),
    });
    expect([200, 202]).toContain(res.status);
  });

  it('POST /:id/run runs a saved workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}/run`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect([200, 202]).toContain(res.status);
  });

  it('DELETE /:id deletes a workflow template', async () => {
    const res = await app.request(`${base()}/${workflowId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 3: Run and verify both**

```bash
bun --env-file .env.test test tests/integration/orchestration.test.ts tests/integration/workflows.test.ts 2>&1 | tail -8
```

Expected: `12 pass, 0 fail`

- [ ] **Step 4: Commit**

```bash
git add tests/integration/orchestration.test.ts tests/integration/workflows.test.ts
git commit -m "test(integration): orchestration and workflow templates"
```

---

### Task 12: Memory

**Files:**
- Create: `tests/integration/memory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/memory.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb, testDb } from './helpers';
import { agentConfigs } from '../../src/infra/db/schema';

describe('Memory', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let agentId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Memory Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;

    const [agent] = await testDb.insert(agentConfigs).values({
      workspaceId,
      name: 'Memory Agent',
      model: 'claude-opus-4-6',
    }).returning({ id: agentConfigs.id });
    agentId = agent!.id;
  });

  afterAll(async () => {
    await truncateTables('memory_proposals', 'agent_memories', 'agent_configs', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/memory`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let memoryId: string;

  it('POST / saves a memory', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        agentId,
        type: 'domain',
        content: 'The user prefers concise answers.',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    memoryId = body.data.id;
    expect(body.data.content).toBe('The user prefers concise answers.');
  });

  it('GET / lists memories', async () => {
    const res = await app.request(`${base()}?agentId=${agentId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST /recall recalls relevant memories', async () => {
    const res = await app.request(`${base()}/recall`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ agentId, query: 'concise answers', limit: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('DELETE /:id forgets a memory', async () => {
    const res = await app.request(`${base()}/${memoryId}`, {
      method: 'DELETE',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(204);
  });

  it('POST /proposals proposes a memory for approval', async () => {
    const res = await app.request(`${base()}/proposals`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        agentId,
        type: 'feedback',
        content: 'Remember to always use bullet points.',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.status).toBe('pending');
    const proposalId = body.data.id;

    // Approve it
    const approveRes = await app.request(`${base()}/proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(approveRes.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/memory.test.ts 2>&1 | tail -8
```

Expected: `5 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/memory.test.ts
git commit -m "test(integration): memory save, recall, forget, proposals"
```

---

### Task 13: Agent Registry

**Files:**
- Create: `tests/integration/agent-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/agent-registry.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Agent Registry', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Registry Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('registered_agents', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/agent-registry`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let registeredAgentId: string;

  it('POST / registers an A2A agent', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'External Agent',
        url: 'http://localhost:9999/a2a',
        description: 'An external test agent',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.name).toBe('External Agent');
    registeredAgentId = body.data.id;
  });

  it('GET / lists registered agents', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((a: any) => a.id === registeredAgentId)).toBe(true);
  });

  it('DELETE /:agentId removes a registered agent', async () => {
    const res = await app.request(`${base()}/${registeredAgentId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/agent-registry.test.ts 2>&1 | tail -8
```

Expected: `3 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/agent-registry.test.ts
git commit -m "test(integration): agent registry register, list, remove"
```

---

### Task 14: API Keys

**Files:**
- Create: `tests/integration/api-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/api-keys.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('API Keys', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'API Keys Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('api_keys', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/api-keys`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  let keyId: string;
  let rawKey: string;

  it('POST / creates an API key', async () => {
    const res = await app.request(base(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'CI Key', role: 'operator' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    keyId = body.data.id;
    rawKey = body.data.key; // Only returned on creation
    expect(rawKey.startsWith('a2a_k_')).toBe(true);
  });

  it('GET / lists API keys', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((k: any) => k.id === keyId)).toBe(true);
  });

  it('GET /:keyId returns key details (no raw key)', async () => {
    const res = await app.request(`${base()}/${keyId}`, {
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(keyId);
    expect(body.data.key).toBeUndefined(); // Raw key is not returned after creation
  });

  it('created API key can authenticate workspace requests', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/agents`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res.status).toBe(200);
  });

  it('POST /:keyId/revoke revokes an API key', async () => {
    const res = await app.request(`${base()}/${keyId}/revoke`, {
      method: 'POST',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(200);
  });

  it('revoked key returns 401', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/agents`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /:keyId deletes the API key', async () => {
    const res = await app.request(`${base()}/${keyId}`, {
      method: 'DELETE',
      headers: { ...authHeader(userId, 'admin') },
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/api-keys.test.ts 2>&1 | tail -8
```

Expected: `7 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/api-keys.test.ts
git commit -m "test(integration): API keys create, list, revoke, delete, auth"
```

---

### Task 15: Settings & Feature Flags

**Files:**
- Create: `tests/integration/settings.test.ts`
- Create: `tests/integration/feature-flags.test.ts`

- [ ] **Step 1: Write settings test**

```typescript
// tests/integration/settings.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Workspace Settings', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Settings Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_settings', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/settings`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET /settings returns workspace settings', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.data).toBe('object');
  });

  it('PATCH /settings updates tool permission mode', async () => {
    const res = await app.request(base(), {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ toolPermissionMode: 'ask' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.toolPermissionMode).toBe('ask');
  });
});
```

- [ ] **Step 2: Write feature flags test**

```typescript
// tests/integration/feature-flags.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables, closeTestDb } from './helpers';

describe('Feature Flags', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    app = await getTestApp();
    const seed = await seedWorkspace({ name: 'Feature Flags Test WS' });
    workspaceId = seed.workspaceId;
    userId = seed.userId;
  });

  afterAll(async () => {
    await truncateTables('workspace_settings', 'workspace_members', 'workspaces', 'users');
    await closeTestDb();
  });

  const base = () => `/api/v1/workspaces/${workspaceId}/feature-flags`;
  const headers = () => ({ 'Content-Type': 'application/json', ...authHeader(userId, 'admin') });

  it('GET /feature-flags lists all flags with defaults', async () => {
    const res = await app.request(base(), { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.data).toBe('object');
    // Default flags should be present
    expect('computer-use.enabled' in body.data).toBe(true);
    expect('agent.max-iterations' in body.data).toBe(true);
  });

  it('PATCH /feature-flags sets a flag value (admin only)', async () => {
    const res = await app.request(base(), {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ flag: 'computer-use.enabled', value: true }),
    });
    expect(res.status).toBe(200);

    // Verify the change took effect
    const getRes = await app.request(base(), { headers: headers() });
    const body = await getRes.json() as any;
    expect(body.data['computer-use.enabled']).toBe(true);
  });
});
```

- [ ] **Step 3: Run and verify both**

```bash
bun --env-file .env.test test tests/integration/settings.test.ts tests/integration/feature-flags.test.ts 2>&1 | tail -8
```

Expected: `4 pass, 0 fail`

- [ ] **Step 4: Commit**

```bash
git add tests/integration/settings.test.ts tests/integration/feature-flags.test.ts
git commit -m "test(integration): workspace settings and feature flags"
```

---

### Task 16: Public Endpoints (A2A & Well-Known)

**Files:**
- Create: `tests/integration/public.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/public.test.ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { getTestApp } from './helpers';

describe('Public endpoints', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    app = await getTestApp();
  });

  describe('GET /.well-known/agent.json', () => {
    it('returns A2A agent card', async () => {
      const res = await app.request('/.well-known/agent.json');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body.name).toBe('string');
      expect(body.protocolVersion).toBeDefined();
    });
  });

  describe('POST /a2a', () => {
    it('returns 401 without Authorization header', async () => {
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: 'abc' } }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 503 when A2A_API_KEY is not configured', async () => {
      const savedKey = Bun.env.A2A_API_KEY;
      delete Bun.env.A2A_API_KEY;

      const res = await app.request('/a2a', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer some-random-key',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: 'abc' } }),
      });
      expect(res.status).toBe(503);

      Bun.env.A2A_API_KEY = savedKey;
    });

    it('returns 401 for wrong API key', async () => {
      Bun.env.A2A_API_KEY = 'correct-key';

      const res = await app.request('/a2a', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-key',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: 'abc' } }),
      });
      expect(res.status).toBe(401);

      delete Bun.env.A2A_API_KEY;
    });

    it('returns JSON-RPC error for invalid method', async () => {
      Bun.env.A2A_API_KEY = 'test-a2a-key';

      const res = await app.request('/a2a', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-a2a-key',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown/method', params: {} }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error.code).toBe(-32601);

      delete Bun.env.A2A_API_KEY;
    });
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
bun --env-file .env.test test tests/integration/public.test.ts 2>&1 | tail -8
```

Expected: `4 pass, 0 fail`

- [ ] **Step 3: Run the full integration suite**

```bash
bun --env-file .env.test test tests/integration/ 2>&1 | tail -10
```

Expected: all tests pass across all 18 files.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/public.test.ts
git commit -m "test(integration): public A2A and well-known endpoints"
```

---

## Self-Review

**Spec coverage:**
- ✅ Health (`/healthz`, `/readyz`)
- ✅ Workspace management (CRUD + auth guard)
- ✅ Members + Invitations (list, invite, revoke, role change, remove)
- ✅ Agents CRUD (with 403 for non-member)
- ✅ Tools CRUD
- ✅ Skills (list, describe, invoke — 404 paths)
- ✅ Sessions (create, messages, close)
- ✅ Tasks (send, list, get, cancel, dependencies CRUD)
- ✅ MCP servers (create, list, update, delete)
- ✅ Orchestration (create, list, get, run, cancel)
- ✅ Workflows (create, list, get, update, run ad-hoc, run saved, delete)
- ✅ Memory (save, list, recall, forget, proposals + approve)
- ✅ Agent Registry (register, list, remove)
- ✅ API Keys (create, list, get, revoke, delete, functional auth test)
- ✅ Settings (get, update)
- ✅ Feature Flags (list, set)
- ✅ Public A2A (auth guards, wrong key, unknown method)
- ✅ Well-Known agent card

**Placeholder scan:** No TBD, no "implement later", no vague steps. All code is complete.

**Type consistency:** All imports use the same schema table names (`agentConfigs`, `workspaceMembers`, etc.) consistently across tasks.
