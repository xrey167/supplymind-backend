# Foundation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend multi-tenant-complete by implementing user sync, workspace CRUD, member/invitation management, role model reconciliation, and soft-delete — keeping all domain-specific behavior pluggable via events.

**Architecture:** Two-tier role model (workspace roles mapped to RBAC roles at middleware boundary). Users are a thin Clerk sync table. Workspaces use soft-delete + RESTRICT FKs + event-driven cleanup. Invitations use hashed tokens with row-level locking for concurrent safety.

**Tech Stack:** Bun runtime, Hono + @hono/zod-openapi, Drizzle ORM (Postgres), Zod v4, @clerk/backend (webhook verification), existing EventBus, BullMQ cleanup job.

**Spec:** `docs/superpowers/specs/2026-04-06-foundation-layer-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/infra/db/schema/index.ts` | Add `users` table, `workspaceInvitations` table, `deletedAt` on workspaces, FK constraints on workspace_settings |
| `src/core/security/rbac.ts` | Add `mapWorkspaceRole()`, `ResolvedRoles` interface |
| `src/api/middlewares/workspace.ts` | Store both `callerRole` (RBAC) and `workspaceRole` (original) in context |
| `src/api/middlewares/auth.ts` | Add `lastSeenAt` fire-and-forget update for JWT users |
| `src/events/topics.ts` | Add 10 new foundation topics |
| `src/config/env.ts` | Add `CLERK_WEBHOOK_SECRET` |
| `src/modules/users/users.repo.ts` | Replace stub — upsert, find, delete |
| `src/modules/users/users.service.ts` | Replace stub — syncFromClerk, orphan handling |
| `src/modules/users/users.types.ts` | Replace stub — User type |
| `src/modules/users/index.ts` | Re-export repo + service |
| `src/modules/workspaces/workspaces.repo.ts` | Replace stub — full CRUD + soft-delete |
| `src/modules/workspaces/workspaces.service.ts` | Replace stub — CRUD + slug + events + transactions |
| `src/modules/workspaces/workspaces.types.ts` | Replace stub — Workspace types |
| `src/modules/workspaces/workspaces.schemas.ts` | Replace stub — Zod schemas |
| `src/modules/workspaces/workspaces.routes.ts` | Replace stub — 5 management routes |
| `src/modules/workspaces/index.ts` | Re-export |
| `src/modules/members/members.repo.ts` | Replace stub — member CRUD with locking |
| `src/modules/members/invitations.repo.ts` | **New** — invitation CRUD with hashed tokens |
| `src/modules/members/members.service.ts` | Replace stub — invite, accept, remove, role change |
| `src/modules/members/members.types.ts` | Replace stub — Member, Invitation types |
| `src/modules/members/members.schemas.ts` | Replace stub — Zod schemas |
| `src/modules/members/members.routes.ts` | Replace stub — 6 member routes |
| `src/modules/members/members.providers.ts` | **New** — InvitationDeliveryProvider interface |
| `src/modules/members/index.ts` | Re-export |
| `src/api/routes/webhooks/clerk.ts` | **New** — Clerk webhook handler |
| `src/api/routes/workspace/index.ts` | Mount members routes |
| `src/app/create-app.ts` | Mount webhook, workspace-management, invitation routes |
| `src/jobs/cleanup/index.ts` | Add invitation cleanup + workspace hard-delete steps |
| `scripts/create-admin.ts` | Refactor to use repo layer directly |

---

### Task 1: Event Topics + Config

**Files:**
- Modify: `src/events/topics.ts`
- Modify: `src/config/env.ts`
- Test: `src/events/__tests__/topics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/events/__tests__/topics.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { Topics } from '../topics';

describe('Foundation event topics', () => {
  it('has workspace lifecycle topics', () => {
    expect(Topics.WORKSPACE_CREATED).toBe('workspace.created');
    expect(Topics.WORKSPACE_UPDATED).toBe('workspace.updated');
    expect(Topics.WORKSPACE_DELETING).toBe('workspace.deleting');
    expect(Topics.WORKSPACE_DELETED).toBe('workspace.deleted');
  });

  it('has member lifecycle topics', () => {
    expect(Topics.MEMBER_INVITED).toBe('member.invited');
    expect(Topics.MEMBER_JOINED).toBe('member.joined');
    expect(Topics.MEMBER_REMOVED).toBe('member.removed');
    expect(Topics.MEMBER_ROLE_CHANGED).toBe('member.role_changed');
  });

  it('has user sync topics', () => {
    expect(Topics.USER_SYNCED).toBe('user.synced');
    expect(Topics.USER_DELETED).toBe('user.deleted');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/events/__tests__/topics.test.ts`
Expected: FAIL — `Topics.WORKSPACE_CREATED` is `undefined`

- [ ] **Step 3: Add foundation topics to topics.ts**

In `src/events/topics.ts`, add these entries inside the `Topics` object before the closing `} as const`:

```typescript
  // Workspace lifecycle
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_UPDATED: 'workspace.updated',
  WORKSPACE_DELETING: 'workspace.deleting',
  WORKSPACE_DELETED: 'workspace.deleted',
  // Member lifecycle
  MEMBER_INVITED: 'member.invited',
  MEMBER_JOINED: 'member.joined',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  // User sync
  USER_SYNCED: 'user.synced',
  USER_DELETED: 'user.deleted',
```

- [ ] **Step 4: Add CLERK_WEBHOOK_SECRET to env schema**

In `src/config/env.ts`, add to the `envSchema` object:

```typescript
  CLERK_WEBHOOK_SECRET: z.string().optional(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/events/__tests__/topics.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/events/topics.ts src/events/__tests__/topics.test.ts src/config/env.ts
git commit -m "feat: add foundation event topics and CLERK_WEBHOOK_SECRET env var"
```

---

### Task 2: Role Model Reconciliation

**Files:**
- Modify: `src/core/security/rbac.ts`
- Modify: `src/api/middlewares/workspace.ts`
- Test: `src/core/security/__tests__/rbac.test.ts`
- Test: `src/api/middlewares/__tests__/workspace.test.ts` (update existing)

- [ ] **Step 1: Write the failing test for mapWorkspaceRole**

Create `src/core/security/__tests__/rbac.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { mapWorkspaceRole, hasPermission } from '../rbac';

describe('mapWorkspaceRole', () => {
  it('maps owner to admin', () => {
    expect(mapWorkspaceRole('owner')).toBe('admin');
  });

  it('maps admin to admin', () => {
    expect(mapWorkspaceRole('admin')).toBe('admin');
  });

  it('maps member to operator', () => {
    expect(mapWorkspaceRole('member')).toBe('operator');
  });

  it('maps viewer to viewer', () => {
    expect(mapWorkspaceRole('viewer')).toBe('viewer');
  });

  it('maps unknown role to viewer (safe default)', () => {
    expect(mapWorkspaceRole('nonsense')).toBe('viewer');
  });
});

describe('hasPermission with mapped workspace roles', () => {
  it('mapped owner (admin) can access operator-level resources', () => {
    const mapped = mapWorkspaceRole('owner');
    expect(hasPermission(mapped, 'operator')).toBe(true);
  });

  it('mapped member (operator) cannot access admin-level resources', () => {
    const mapped = mapWorkspaceRole('member');
    expect(hasPermission(mapped, 'admin')).toBe(false);
  });

  it('mapped viewer can only access viewer-level resources', () => {
    const mapped = mapWorkspaceRole('viewer');
    expect(hasPermission(mapped, 'viewer')).toBe(true);
    expect(hasPermission(mapped, 'operator')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/security/__tests__/rbac.test.ts`
Expected: FAIL — `mapWorkspaceRole is not a function`

- [ ] **Step 3: Implement mapWorkspaceRole in rbac.ts**

Add to the end of `src/core/security/rbac.ts` (before nothing — it's the last line):

```typescript
/** Map workspace role to RBAC role at the middleware boundary */
const WORKSPACE_ROLE_MAP: Record<string, Role> = {
  owner: 'admin',
  admin: 'admin',
  member: 'operator',
  viewer: 'viewer',
};

export function mapWorkspaceRole(workspaceRole: string): Role {
  return WORKSPACE_ROLE_MAP[workspaceRole] ?? 'viewer';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/security/__tests__/rbac.test.ts`
Expected: PASS

- [ ] **Step 5: Update workspace middleware to use mapWorkspaceRole**

Replace `src/api/middlewares/workspace.ts` entirely:

```typescript
import { createMiddleware } from 'hono/factory';
import { ForbiddenError } from '../../core/errors';
import { mapWorkspaceRole } from '../../core/security/rbac';
import { logger } from '../../config/logger';
import { mcpService } from '../../modules/mcp/mcp.service';
import { db } from '../../infra/db/client';
import { workspaceMembers, workspaces } from '../../infra/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

export const workspaceMiddleware = createMiddleware(async (c, next) => {
  const workspaceId = c.req.param('workspaceId') ?? c.req.header('X-Workspace-Id');
  if (!workspaceId) {
    throw new ForbiddenError('Missing workspace context');
  }

  // Set workspace context for downstream handlers
  c.set('workspaceId', workspaceId);

  // Lazy-load workspace MCP servers (fire-and-forget, idempotent)
  mcpService.ensureWorkspaceLoaded(workspaceId).catch((err) => {
    logger.warn({ err, workspaceId }, 'Failed to lazy-load workspace MCP servers');
  });

  // Membership verification
  const callerId = c.get('callerId') as string | undefined;
  if (callerId?.startsWith('apikey:')) {
    // API keys are workspace-scoped — but must check workspace not soft-deleted
    const [ws] = await db.select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!ws) {
      throw new ForbiddenError('Workspace not found or deleted');
    }
    return next();
  }

  if (callerId) {
    // Join workspace_members with workspaces to check deletedAt in one query
    const [member] = await db.select({
      role: workspaceMembers.role,
      deletedAt: workspaces.deletedAt,
    })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, callerId),
      ))
      .limit(1);

    if (!member || member.deletedAt !== null) {
      throw new ForbiddenError(member?.deletedAt ? 'Workspace has been deleted' : 'Not a member of this workspace');
    }

    // Store BOTH roles: mapped RBAC role for permission checks, original for owner-specific logic
    c.set('callerRole', mapWorkspaceRole(member.role));
    c.set('workspaceRole', member.role);
  }

  logger.debug({ workspaceId, callerId }, 'Workspace context set');
  return next();
});
```

- [ ] **Step 6: Run all existing tests**

Run: `bun test`
Expected: All tests pass. If `src/api/middlewares/__tests__/workspace.test.ts` exists and asserts `role === 'member'`, update it to assert `callerRole === 'operator'` and add assertion for `workspaceRole === 'member'`.

- [ ] **Step 7: Commit**

```bash
git add src/core/security/rbac.ts src/core/security/__tests__/rbac.test.ts src/api/middlewares/workspace.ts
git commit -m "feat: add mapWorkspaceRole and preserve both roles in workspace middleware"
```

---

### Task 3: Schema Changes

**Files:**
- Modify: `src/infra/db/schema/index.ts`

This task adds the `users` table, `workspaceInvitations` table, `deletedAt` column on workspaces, and FK on workspace_settings. No tests here — schema correctness is verified by migration generation + the modules that use them.

- [ ] **Step 1: Add `deletedAt` column to workspaces table**

In `src/infra/db/schema/index.ts`, modify the `workspaces` table definition. Add `deletedAt` after `updatedAt`:

```typescript
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (t) => [
  uniqueIndex('workspaces_slug_idx').on(t.slug),
]);
```

- [ ] **Step 2: Add `users` table**

Add after the `workspaceMembers` table definition:

```typescript
// Users — thin sync from Clerk
export const users = pgTable('users', {
  id: text('id').primaryKey(),              // Clerk userId (e.g. user_2x7...)
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('users_email_idx').on(t.email),
]);
```

- [ ] **Step 3: Add `workspaceInvitations` table**

Add after the `users` table:

```typescript
// Workspace invitations
export const workspaceInvitations = pgTable('workspace_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email'),                     // null for link-only invites
  tokenHash: text('token_hash').notNull(),  // SHA-256 of nanoid token
  type: text('type').notNull(),             // 'email' | 'link'
  role: workspaceRoleEnum('role').notNull().default('member'),
  invitedBy: text('invited_by').notNull(),  // userId
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('wi_token_hash_idx').on(t.tokenHash),
  uniqueIndex('wi_workspace_email_idx').on(t.workspaceId, t.email),
]);
```

- [ ] **Step 4: Add FK on workspace_settings**

Modify the `workspaceSettings` table to add the FK reference:

```typescript
export const workspaceSettings = pgTable('workspace_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('ws_settings_workspace_key_idx').on(t.workspaceId, t.key),
]);
```

- [ ] **Step 5: Generate migration**

Run: `bun run db:generate`
Expected: Migration file created in `drizzle/` directory. Review the SQL to verify it includes CREATE TABLE for `users` and `workspace_invitations`, ALTER TABLE for `workspaces` (add `deleted_at`), and ALTER TABLE for `workspace_settings` (add FK).

- [ ] **Step 6: Push schema (dev)**

Run: `bun run db:push`
Expected: Schema applied successfully.

- [ ] **Step 7: Commit**

```bash
git add src/infra/db/schema/index.ts drizzle/
git commit -m "feat: add users, workspace_invitations tables, deletedAt on workspaces, FK on workspace_settings"
```

---

### Task 4: Users Module

**Files:**
- Create: `src/modules/users/users.types.ts`
- Create: `src/modules/users/users.repo.ts`
- Create: `src/modules/users/users.service.ts`
- Modify: `src/modules/users/index.ts`
- Delete: `src/modules/users/users.routes.ts` (no user CRUD routes)
- Delete: `src/modules/users/users.controller.ts`
- Delete: `src/modules/users/users.schemas.ts`
- Delete: `src/modules/users/users.mapper.ts`
- Delete: `src/modules/users/users.events.ts`
- Test: `src/modules/users/__tests__/users.repo.test.ts`
- Test: `src/modules/users/__tests__/users.service.test.ts`

- [ ] **Step 1: Write users.types.ts**

Replace `src/modules/users/users.types.ts`:

```typescript
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string; id: string }>;
    primary_email_address_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    image_url?: string | null;
  };
}
```

- [ ] **Step 2: Write the failing test for users.repo**

Create `src/modules/users/__tests__/users.repo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { usersRepo } from '../users.repo';
import { db } from '../../../infra/db/client';
import { users } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';

// These are integration tests — require a running database
// Skip in CI if DATABASE_URL is not set
const testUserId = 'user_test_' + Date.now();
const testEmail = `test-${Date.now()}@example.com`;

describe('UsersRepository', () => {
  afterAll(async () => {
    // Clean up test data
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('upserts a new user', async () => {
    const user = await usersRepo.upsert({
      id: testUserId,
      email: testEmail,
      name: 'Test User',
      avatarUrl: null,
    });
    expect(user.id).toBe(testUserId);
    expect(user.email).toBe(testEmail);
    expect(user.name).toBe('Test User');
  });

  it('upserts an existing user (updates)', async () => {
    const user = await usersRepo.upsert({
      id: testUserId,
      email: testEmail,
      name: 'Updated Name',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(user.name).toBe('Updated Name');
    expect(user.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('finds user by id', async () => {
    const user = await usersRepo.findById(testUserId);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(testEmail);
  });

  it('finds user by email', async () => {
    const user = await usersRepo.findByEmail(testEmail);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(testUserId);
  });

  it('returns null for non-existent user', async () => {
    const user = await usersRepo.findById('user_nonexistent');
    expect(user).toBeNull();
  });

  it('updates lastSeenAt', async () => {
    await usersRepo.updateLastSeen(testUserId);
    const user = await usersRepo.findById(testUserId);
    expect(user!.lastSeenAt).not.toBeNull();
  });

  it('deletes user', async () => {
    await usersRepo.delete(testUserId);
    const user = await usersRepo.findById(testUserId);
    expect(user).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/modules/users/__tests__/users.repo.test.ts`
Expected: FAIL — `usersRepo` cannot be imported

- [ ] **Step 4: Implement users.repo.ts**

Replace `src/modules/users/users.repo.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { users } from '../../infra/db/schema';
import type { User } from './users.types';

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

class UsersRepository {
  async upsert(input: { id: string; email: string; name?: string | null; avatarUrl?: string | null }): Promise<User> {
    const rows = await db.insert(users).values({
      id: input.id,
      email: input.email,
      name: input.name ?? null,
      avatarUrl: input.avatarUrl ?? null,
    }).onConflictDoUpdate({
      target: users.id,
      set: {
        email: input.email,
        name: input.name ?? null,
        avatarUrl: input.avatarUrl ?? null,
        updatedAt: new Date(),
      },
    }).returning();
    return toUser(rows[0]!);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async updateLastSeen(id: string): Promise<void> {
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, id));
  }

  async delete(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}

export const usersRepo = new UsersRepository();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/modules/users/__tests__/users.repo.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for users.service**

Create `src/modules/users/__tests__/users.service.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { usersService } from '../users.service';
import type { ClerkWebhookEvent } from '../users.types';

// Mock the repo and eventBus at module level
const mockUpsert = mock(() => Promise.resolve({ id: 'user_1', email: 'a@b.com', name: 'A', avatarUrl: null, lastSeenAt: null, createdAt: new Date(), updatedAt: new Date() }));
const mockDelete = mock(() => Promise.resolve());
const mockPublish = mock(() => '');

mock.module('../users.repo', () => ({
  usersRepo: { upsert: mockUpsert, delete: mockDelete, findById: mock(() => Promise.resolve(null)) },
}));
mock.module('../../../events/bus', () => ({
  eventBus: { publish: mockPublish },
}));

describe('UsersService.syncFromClerk', () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockDelete.mockClear();
    mockPublish.mockClear();
  });

  it('upserts user on user.created', async () => {
    const event: ClerkWebhookEvent = {
      type: 'user.created',
      data: {
        id: 'user_1',
        email_addresses: [{ email_address: 'a@b.com', id: 'email_1' }],
        primary_email_address_id: 'email_1',
        first_name: 'Alice',
        last_name: 'Bob',
        image_url: null,
      },
    };
    await usersService.syncFromClerk(event);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalled();
  });

  it('deletes user on user.deleted', async () => {
    const event: ClerkWebhookEvent = {
      type: 'user.deleted',
      data: { id: 'user_1' },
    };
    await usersService.syncFromClerk(event);
    expect(mockDelete).toHaveBeenCalledWith('user_1');
    expect(mockPublish).toHaveBeenCalled();
  });

  it('ignores unknown event types', async () => {
    const event: ClerkWebhookEvent = {
      type: 'user.unknown_event',
      data: { id: 'user_1' },
    };
    await usersService.syncFromClerk(event);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test src/modules/users/__tests__/users.service.test.ts`
Expected: FAIL — `usersService` export doesn't have `syncFromClerk`

- [ ] **Step 8: Implement users.service.ts**

Replace `src/modules/users/users.service.ts`:

```typescript
import { usersRepo } from './users.repo';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { logger } from '../../config/logger';
import type { ClerkWebhookEvent } from './users.types';

class UsersService {
  async syncFromClerk(event: ClerkWebhookEvent): Promise<void> {
    const { type, data } = event;

    switch (type) {
      case 'user.created':
      case 'user.updated': {
        const primaryEmail = data.email_addresses?.find(
          (e) => e.id === data.primary_email_address_id,
        );
        if (!primaryEmail) {
          logger.warn({ userId: data.id }, 'Clerk webhook: no primary email found, skipping');
          return;
        }
        const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
        await usersRepo.upsert({
          id: data.id,
          email: primaryEmail.email_address,
          name,
          avatarUrl: data.image_url ?? null,
        });
        eventBus.publish(Topics.USER_SYNCED, {
          userId: data.id,
          email: primaryEmail.email_address,
          action: type === 'user.created' ? 'created' : 'updated',
        });
        break;
      }

      case 'user.deleted': {
        // Handle orphaned workspaces: soft-delete workspaces where this user is sole owner
        await this.handleOrphanedWorkspaces(data.id);
        await usersRepo.delete(data.id);
        eventBus.publish(Topics.USER_DELETED, { userId: data.id });
        break;
      }

      default:
        logger.debug({ type }, 'Clerk webhook: unhandled event type');
    }
  }

  /**
   * When a Clerk user is deleted, find workspaces where they're the sole owner
   * and soft-delete them to prevent orphaned workspaces with no owner.
   */
  private async handleOrphanedWorkspaces(userId: string): Promise<void> {
    // Import lazily to avoid circular dependency
    const { workspacesRepo } = await import('../workspaces/workspaces.repo');
    const { membersRepo } = await import('../members/members.repo');

    const membershipRows = await membersRepo.findByUserId(userId);
    for (const membership of membershipRows) {
      if (membership.role !== 'owner') continue;
      const ownerCount = await membersRepo.countOwners(membership.workspaceId);
      if (ownerCount <= 1) {
        logger.warn({ workspaceId: membership.workspaceId, userId }, 'Soft-deleting orphaned workspace (sole owner deleted from Clerk)');
        await workspacesRepo.softDelete(membership.workspaceId);
        eventBus.publish(Topics.WORKSPACE_DELETING, {
          workspaceId: membership.workspaceId,
          deletedBy: 'system:clerk-user-deleted',
        });
      }
    }
  }
}

export const usersService = new UsersService();
```

- [ ] **Step 9: Update index.ts**

Replace `src/modules/users/index.ts`:

```typescript
export { usersRepo } from './users.repo';
export { usersService } from './users.service';
export type { User, ClerkWebhookEvent } from './users.types';
```

- [ ] **Step 10: Delete unused stub files**

```bash
rm src/modules/users/users.routes.ts src/modules/users/users.controller.ts src/modules/users/users.schemas.ts src/modules/users/users.mapper.ts src/modules/users/users.events.ts
```

- [ ] **Step 11: Run test to verify service test passes**

Run: `bun test src/modules/users/__tests__/users.service.test.ts`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/modules/users/
git commit -m "feat: implement users module — Clerk sync, repo, service"
```

---

### Task 5: Workspaces Module

**Files:**
- Create: `src/modules/workspaces/workspaces.types.ts`
- Create: `src/modules/workspaces/workspaces.schemas.ts`
- Create: `src/modules/workspaces/workspaces.repo.ts`
- Create: `src/modules/workspaces/workspaces.service.ts`
- Create: `src/modules/workspaces/workspaces.routes.ts`
- Modify: `src/modules/workspaces/index.ts`
- Delete: `src/modules/workspaces/workspaces.controller.ts`
- Delete: `src/modules/workspaces/workspaces.mapper.ts`
- Delete: `src/modules/workspaces/workspaces.events.ts`
- Delete: `src/modules/workspaces/workspaces.policy.ts`
- Test: `src/modules/workspaces/__tests__/workspaces.repo.test.ts`
- Test: `src/modules/workspaces/__tests__/workspaces.service.test.ts`

- [ ] **Step 1: Write workspaces.types.ts**

Replace `src/modules/workspaces/workspaces.types.ts`:

```typescript
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateWorkspaceInput {
  name: string;
  userId: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
}
```

- [ ] **Step 2: Write workspaces.schemas.ts**

Replace `src/modules/workspaces/workspaces.schemas.ts`:

```typescript
import { z } from 'zod';

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
});

export const workspaceIdParamSchema = z.object({
  workspaceId: z.string().uuid(),
});
```

- [ ] **Step 3: Write the failing test for workspaces.repo**

Create `src/modules/workspaces/__tests__/workspaces.repo.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'bun:test';
import { workspacesRepo } from '../workspaces.repo';
import { db } from '../../../infra/db/client';
import { workspaces, workspaceMembers } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';

const testSlug = `test-ws-${Date.now()}`;
let createdId: string;

describe('WorkspacesRepository', () => {
  afterAll(async () => {
    if (createdId) {
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, createdId));
      await db.delete(workspaces).where(eq(workspaces.id, createdId));
    }
  });

  it('creates a workspace', async () => {
    const ws = await workspacesRepo.create({ name: 'Test Workspace', slug: testSlug, createdBy: 'user_test' });
    createdId = ws.id;
    expect(ws.name).toBe('Test Workspace');
    expect(ws.slug).toBe(testSlug);
    expect(ws.deletedAt).toBeNull();
  });

  it('finds by id', async () => {
    const ws = await workspacesRepo.findById(createdId);
    expect(ws).not.toBeNull();
    expect(ws!.name).toBe('Test Workspace');
  });

  it('finds by slug', async () => {
    const ws = await workspacesRepo.findBySlug(testSlug);
    expect(ws).not.toBeNull();
    expect(ws!.id).toBe(createdId);
  });

  it('updates name', async () => {
    const ws = await workspacesRepo.update(createdId, { name: 'Updated' });
    expect(ws!.name).toBe('Updated');
  });

  it('soft-deletes workspace', async () => {
    await workspacesRepo.softDelete(createdId);
    // findById filters deletedAt IS NULL
    const ws = await workspacesRepo.findById(createdId);
    expect(ws).toBeNull();
  });

  it('restores workspace', async () => {
    await workspacesRepo.restore(createdId);
    const ws = await workspacesRepo.findById(createdId);
    expect(ws).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/modules/workspaces/__tests__/workspaces.repo.test.ts`
Expected: FAIL — `workspacesRepo` cannot be imported

- [ ] **Step 5: Implement workspaces.repo.ts**

Replace `src/modules/workspaces/workspaces.repo.ts`:

```typescript
import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspaces, workspaceMembers } from '../../infra/db/schema';
import type { Workspace } from './workspaces.types';

function toWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.createdBy,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
    deletedAt: row.deletedAt,
  };
}

class WorkspacesRepository {
  async create(input: { name: string; slug: string; createdBy: string }): Promise<Workspace> {
    const rows = await db.insert(workspaces).values({
      name: input.name,
      slug: input.slug,
      createdBy: input.createdBy,
    }).returning();
    return toWorkspace(rows[0]!);
  }

  async findById(id: string): Promise<Workspace | null> {
    const rows = await db.select().from(workspaces)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .limit(1);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const rows = await db.select().from(workspaces)
      .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .limit(1);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<Workspace[]> {
    const rows = await db.select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      createdBy: workspaces.createdBy,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      deletedAt: workspaces.deletedAt,
    })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(and(
        eq(workspaceMembers.userId, userId),
        isNull(workspaces.deletedAt),
      ));
    return rows.map(toWorkspace);
  }

  async update(id: string, input: { name?: string; slug?: string }): Promise<Workspace | null> {
    const rows = await db.update(workspaces)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .returning();
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async softDelete(id: string): Promise<void> {
    await db.update(workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(workspaces.id, id));
  }

  async restore(id: string): Promise<void> {
    await db.update(workspaces)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  }

  async findSoftDeleted(olderThanDays: number): Promise<Workspace[]> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const rows = await db.select().from(workspaces)
      .where(lt(workspaces.deletedAt, cutoff));
    return rows.map(toWorkspace);
  }

  async hardDelete(id: string): Promise<void> {
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }

  async slugExists(slug: string): Promise<boolean> {
    const rows = await db.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.slug, slug)).limit(1);
    return rows.length > 0;
  }
}

export const workspacesRepo = new WorkspacesRepository();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/modules/workspaces/__tests__/workspaces.repo.test.ts`
Expected: PASS

- [ ] **Step 7: Implement workspaces.service.ts**

Replace `src/modules/workspaces/workspaces.service.ts`:

```typescript
import { db } from '../../infra/db/client';
import { workspaceMembers } from '../../infra/db/schema';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { NotFoundError, ValidationError } from '../../core/errors';
import { workspacesRepo } from './workspaces.repo';
import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from './workspaces.types';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

class WorkspacesService {
  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    let slug = generateSlug(input.name);

    // Retry with random suffix on collision (up to 3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidateSlug = attempt === 0 ? slug : `${slug}-${randomSuffix()}`;
      const exists = await workspacesRepo.slugExists(candidateSlug);
      if (!exists) {
        slug = candidateSlug;
        break;
      }
      if (attempt === 2) {
        throw new ValidationError(`Could not generate unique slug for "${input.name}"`);
      }
    }

    // Transaction: create workspace + add creator as owner
    const workspace = await db.transaction(async (tx) => {
      const [wsRow] = await tx.insert(
        (await import('../../infra/db/schema')).workspaces,
      ).values({
        name: input.name,
        slug,
        createdBy: input.userId,
      }).returning();

      await tx.insert(workspaceMembers).values({
        workspaceId: wsRow.id,
        userId: input.userId,
        role: 'owner',
      });

      return {
        id: wsRow.id,
        name: wsRow.name,
        slug: wsRow.slug,
        createdBy: wsRow.createdBy,
        createdAt: wsRow.createdAt!,
        updatedAt: wsRow.updatedAt!,
        deletedAt: wsRow.deletedAt,
      } as Workspace;
    });

    eventBus.publish(Topics.WORKSPACE_CREATED, {
      workspaceId: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdBy: input.userId,
    });

    return workspace;
  }

  async getById(id: string): Promise<Workspace> {
    const ws = await workspacesRepo.findById(id);
    if (!ws) throw new NotFoundError(`Workspace not found: ${id}`);
    return ws;
  }

  async getBySlug(slug: string): Promise<Workspace> {
    const ws = await workspacesRepo.findBySlug(slug);
    if (!ws) throw new NotFoundError(`Workspace not found: ${slug}`);
    return ws;
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    return workspacesRepo.findByUserId(userId);
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    if (input.slug) {
      const existing = await workspacesRepo.findBySlug(input.slug);
      if (existing && existing.id !== id) {
        throw new ValidationError(`Slug "${input.slug}" is already taken`);
      }
    }
    const ws = await workspacesRepo.update(id, input);
    if (!ws) throw new NotFoundError(`Workspace not found: ${id}`);

    eventBus.publish(Topics.WORKSPACE_UPDATED, {
      workspaceId: id,
      changes: Object.keys(input),
    });

    return ws;
  }

  async delete(id: string, deletedBy: string): Promise<void> {
    const ws = await workspacesRepo.findById(id);
    if (!ws) throw new NotFoundError(`Workspace not found: ${id}`);

    await workspacesRepo.softDelete(id);

    eventBus.publish(Topics.WORKSPACE_DELETING, {
      workspaceId: id,
      deletedBy,
    });
  }
}

export const workspacesService = new WorkspacesService();
```

- [ ] **Step 8: Implement workspaces.routes.ts**

Replace `src/modules/workspaces/workspaces.routes.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { authMiddleware } from '../../api/middlewares/auth';
import { workspacesService } from './workspaces.service';
import { createWorkspaceSchema, updateWorkspaceSchema, workspaceIdParamSchema } from './workspaces.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const createWsRoute = createRoute({
  method: 'post', path: '/',
  request: { body: { content: { 'application/json': { schema: createWorkspaceSchema } } } },
  responses: { 201: { description: 'Workspace created', ...jsonRes } },
});

const listWsRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'List workspaces', ...jsonRes } },
});

const getWsRoute = createRoute({
  method: 'get', path: '/{workspaceId}',
  request: { params: workspaceIdParamSchema },
  responses: { 200: { description: 'Workspace details', ...jsonRes } },
});

const updateWsRoute = createRoute({
  method: 'patch', path: '/{workspaceId}',
  request: { params: workspaceIdParamSchema, body: { content: { 'application/json': { schema: updateWorkspaceSchema } } } },
  responses: { 200: { description: 'Workspace updated', ...jsonRes } },
});

const deleteWsRoute = createRoute({
  method: 'delete', path: '/{workspaceId}',
  request: { params: workspaceIdParamSchema },
  responses: { 204: { description: 'Workspace deleted' } },
});

export const WorkspacesRoutes = new OpenAPIHono();

// All workspace management routes require authentication
WorkspacesRoutes.use('*', authMiddleware);

WorkspacesRoutes.openapi(createWsRoute, async (c) => {
  const body = c.req.valid('json');
  const callerId = c.get('callerId') as string;
  const workspace = await workspacesService.create({ name: body.name, userId: callerId });
  return c.json({ data: workspace }, 201);
});

WorkspacesRoutes.openapi(listWsRoute, async (c) => {
  const callerId = c.get('callerId') as string;
  const workspaces = await workspacesService.listForUser(callerId);
  return c.json({ data: workspaces });
});

WorkspacesRoutes.openapi(getWsRoute, async (c) => {
  const { workspaceId } = c.req.valid('param');
  const workspace = await workspacesService.getById(workspaceId);
  return c.json({ data: workspace });
});

WorkspacesRoutes.openapi(updateWsRoute, async (c) => {
  const { workspaceId } = c.req.valid('param');
  const body = c.req.valid('json');
  const workspace = await workspacesService.update(workspaceId, body);
  return c.json({ data: workspace });
});

WorkspacesRoutes.openapi(deleteWsRoute, async (c) => {
  const { workspaceId } = c.req.valid('param');
  const callerId = c.get('callerId') as string;
  // Only owners can delete — check workspaceRole
  // Note: this route is NOT behind workspaceMiddleware, so we need manual check
  const { membersRepo } = await import('../members/members.repo');
  const member = await membersRepo.findMember(workspaceId, callerId);
  if (!member || member.role !== 'owner') {
    return c.json({ error: 'Only workspace owners can delete workspaces' }, 403);
  }
  await workspacesService.delete(workspaceId, callerId);
  return c.json({ success: true }, 204);
});
```

- [ ] **Step 9: Update index.ts**

Replace `src/modules/workspaces/index.ts`:

```typescript
export { workspacesRepo } from './workspaces.repo';
export { workspacesService } from './workspaces.service';
export { WorkspacesRoutes } from './workspaces.routes';
export type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from './workspaces.types';
```

- [ ] **Step 10: Delete unused stub files**

```bash
rm src/modules/workspaces/workspaces.controller.ts src/modules/workspaces/workspaces.mapper.ts src/modules/workspaces/workspaces.events.ts src/modules/workspaces/workspaces.policy.ts
```

- [ ] **Step 11: Run tests**

Run: `bun test src/modules/workspaces/__tests__/workspaces.repo.test.ts`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/modules/workspaces/
git commit -m "feat: implement workspaces module — CRUD, soft-delete, slug generation, transactional create"
```

---

### Task 6: Members + Invitations Module

**Files:**
- Create: `src/modules/members/members.types.ts`
- Create: `src/modules/members/members.schemas.ts`
- Create: `src/modules/members/members.repo.ts`
- Create: `src/modules/members/invitations.repo.ts`
- Create: `src/modules/members/members.service.ts`
- Create: `src/modules/members/members.routes.ts`
- Create: `src/modules/members/members.providers.ts`
- Modify: `src/modules/members/index.ts`
- Delete: `src/modules/members/members.controller.ts`
- Delete: `src/modules/members/members.mapper.ts`
- Delete: `src/modules/members/members.events.ts`
- Test: `src/modules/members/__tests__/members.repo.test.ts`
- Test: `src/modules/members/__tests__/invitations.repo.test.ts`
- Test: `src/modules/members/__tests__/members.service.test.ts`

- [ ] **Step 1: Write members.types.ts**

Replace `src/modules/members/members.types.ts`:

```typescript
export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  invitedBy: string | null;
  joinedAt: Date;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string | null;
  tokenHash: string;
  type: 'email' | 'link';
  role: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export interface InviteInput {
  email?: string;
  role?: string;
  invitedBy: string;
}

export interface MemberWithUser extends WorkspaceMember {
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
}
```

- [ ] **Step 2: Write members.schemas.ts**

Replace `src/modules/members/members.schemas.ts`:

```typescript
import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const updateRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

export const memberUserIdParamSchema = z.object({
  userId: z.string().min(1),
});

export const invitationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const invitationTokenParamSchema = z.object({
  token: z.string().min(1),
});
```

- [ ] **Step 3: Write members.providers.ts**

Create `src/modules/members/members.providers.ts`:

```typescript
import type { WorkspaceInvitation } from './members.types';
import type { Workspace } from '../workspaces/workspaces.types';

/**
 * Provider interface for invitation delivery.
 * Foundation ships with no provider — invitations work via link by default.
 * Email delivery is opt-in: implement this and listen to `member.invited` events.
 */
export interface InvitationDeliveryProvider {
  deliver(invitation: WorkspaceInvitation & { token: string }, workspace: Workspace): Promise<void>;
}
```

- [ ] **Step 4: Write the failing test for members.repo**

Create `src/modules/members/__tests__/members.repo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { membersRepo } from '../members.repo';
import { db } from '../../../infra/db/client';
import { workspaces, workspaceMembers } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';

let workspaceId: string;
const userId = 'user_member_test_' + Date.now();
const userId2 = 'user_member_test2_' + Date.now();

describe('MembersRepository', () => {
  beforeAll(async () => {
    // Create a test workspace
    const [ws] = await db.insert(workspaces).values({
      name: 'Members Test',
      slug: `members-test-${Date.now()}`,
      createdBy: userId,
    }).returning();
    workspaceId = ws.id;
    // Add initial owner
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it('adds a member', async () => {
    const member = await membersRepo.addMember(workspaceId, userId2, 'member', userId);
    expect(member.userId).toBe(userId2);
    expect(member.role).toBe('member');
  });

  it('finds a member', async () => {
    const member = await membersRepo.findMember(workspaceId, userId2);
    expect(member).not.toBeNull();
    expect(member!.role).toBe('member');
  });

  it('lists members', async () => {
    const members = await membersRepo.listMembers(workspaceId);
    expect(members.length).toBeGreaterThanOrEqual(2);
  });

  it('updates role', async () => {
    const member = await membersRepo.updateRole(workspaceId, userId2, 'admin');
    expect(member!.role).toBe('admin');
  });

  it('counts owners', async () => {
    const count = await membersRepo.countOwners(workspaceId);
    expect(count).toBe(1); // only userId is owner
  });

  it('removes a member', async () => {
    await membersRepo.removeMember(workspaceId, userId2);
    const member = await membersRepo.findMember(workspaceId, userId2);
    expect(member).toBeNull();
  });

  it('finds memberships by userId', async () => {
    const memberships = await membersRepo.findByUserId(userId);
    expect(memberships.length).toBeGreaterThanOrEqual(1);
    expect(memberships[0].workspaceId).toBe(workspaceId);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `bun test src/modules/members/__tests__/members.repo.test.ts`
Expected: FAIL — `membersRepo` cannot be imported

- [ ] **Step 6: Implement members.repo.ts**

Replace `src/modules/members/members.repo.ts`:

```typescript
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspaceMembers, users } from '../../infra/db/schema';
import type { WorkspaceMember, MemberWithUser } from './members.types';

function toMember(row: typeof workspaceMembers.$inferSelect): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    invitedBy: row.invitedBy,
    joinedAt: row.joinedAt!,
  };
}

class MembersRepository {
  async addMember(workspaceId: string, userId: string, role: string, invitedBy?: string): Promise<WorkspaceMember> {
    const rows = await db.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: role as any,
      invitedBy: invitedBy ?? null,
    }).returning();
    return toMember(rows[0]!);
  }

  async findMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const rows = await db.select().from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ))
      .limit(1);
    return rows[0] ? toMember(rows[0]) : null;
  }

  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    const rows = await db.select({
      id: workspaceMembers.id,
      workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      invitedBy: workspaceMembers.invitedBy,
      joinedAt: workspaceMembers.joinedAt,
      userName: users.name,
      userEmail: users.email,
      userAvatarUrl: users.avatarUrl,
    })
      .from(workspaceMembers)
      .leftJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      userId: r.userId,
      role: r.role,
      invitedBy: r.invitedBy,
      joinedAt: r.joinedAt!,
      userName: r.userName,
      userEmail: r.userEmail,
      userAvatarUrl: r.userAvatarUrl,
    }));
  }

  async updateRole(workspaceId: string, userId: string, role: string): Promise<WorkspaceMember | null> {
    const rows = await db.update(workspaceMembers)
      .set({ role: role as any })
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ))
      .returning();
    return rows[0] ? toMember(rows[0]) : null;
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await db.delete(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ));
  }

  async countMembers(workspaceId: string): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return result?.count ?? 0;
  }

  async countOwners(workspaceId: string): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, 'owner'),
      ));
    return result?.count ?? 0;
  }

  async findByUserId(userId: string): Promise<WorkspaceMember[]> {
    const rows = await db.select().from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    return rows.map(toMember);
  }
}

export const membersRepo = new MembersRepository();
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test src/modules/members/__tests__/members.repo.test.ts`
Expected: PASS

- [ ] **Step 8: Write the failing test for invitations.repo**

Create `src/modules/members/__tests__/invitations.repo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { invitationsRepo } from '../invitations.repo';
import { db } from '../../../infra/db/client';
import { workspaces, workspaceInvitations } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';

let workspaceId: string;
let createdTokenHash: string;

describe('InvitationsRepository', () => {
  beforeAll(async () => {
    const [ws] = await db.insert(workspaces).values({
      name: 'Invitations Test',
      slug: `inv-test-${Date.now()}`,
      createdBy: 'user_inv_test',
    }).returning();
    workspaceId = ws.id;
  });

  afterAll(async () => {
    await db.delete(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it('creates an invitation and returns token + hash', async () => {
    const result = await invitationsRepo.create(workspaceId, {
      email: 'invited@example.com',
      type: 'email',
      role: 'member',
      invitedBy: 'user_inv_test',
    });
    expect(result.token).toBeTruthy();
    expect(result.invitation.tokenHash).toBeTruthy();
    expect(result.invitation.email).toBe('invited@example.com');
    createdTokenHash = result.invitation.tokenHash;
  });

  it('finds invitation by token hash', async () => {
    const inv = await invitationsRepo.findByTokenHash(createdTokenHash);
    expect(inv).not.toBeNull();
    expect(inv!.email).toBe('invited@example.com');
  });

  it('finds pending invitation by workspace + email', async () => {
    const inv = await invitationsRepo.findPendingByEmail(workspaceId, 'invited@example.com');
    expect(inv).not.toBeNull();
  });

  it('marks invitation as accepted', async () => {
    const inv = await invitationsRepo.findByTokenHash(createdTokenHash);
    await invitationsRepo.accept(inv!.id);
    const updated = await invitationsRepo.findByTokenHash(createdTokenHash);
    // findByTokenHash filters out accepted ones
    expect(updated).toBeNull();
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `bun test src/modules/members/__tests__/invitations.repo.test.ts`
Expected: FAIL — `invitationsRepo` cannot be imported

- [ ] **Step 10: Implement invitations.repo.ts**

Create `src/modules/members/invitations.repo.ts`:

```typescript
import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspaceInvitations } from '../../infra/db/schema';
import { nanoid } from 'nanoid';
import type { WorkspaceInvitation } from './members.types';

function hashToken(token: string): string {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(token);
  return hash.digest('hex');
}

function toInvitation(row: typeof workspaceInvitations.$inferSelect): WorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    tokenHash: row.tokenHash,
    type: row.type as 'email' | 'link',
    role: row.role,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt!,
  };
}

const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class InvitationsRepository {
  /**
   * Create an invitation. Returns the plaintext token (shown once) and the invitation record.
   */
  async create(workspaceId: string, input: {
    email?: string;
    type: 'email' | 'link';
    role: string;
    invitedBy: string;
    expiresAt?: Date;
  }): Promise<{ token: string; invitation: WorkspaceInvitation }> {
    const token = nanoid(32);
    const tokenHashValue = hashToken(token);
    const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_MS);

    const rows = await db.insert(workspaceInvitations).values({
      workspaceId,
      email: input.email ?? null,
      tokenHash: tokenHashValue,
      type: input.type,
      role: input.role as any,
      invitedBy: input.invitedBy,
      expiresAt,
    }).returning();

    return { token, invitation: toInvitation(rows[0]!) };
  }

  /**
   * Find an invitation by its token hash. Only returns non-expired, non-accepted invitations.
   */
  async findByTokenHash(tokenHash: string): Promise<WorkspaceInvitation | null> {
    const now = new Date();
    const rows = await db.select().from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.tokenHash, tokenHash),
        isNull(workspaceInvitations.acceptedAt),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt < now) return null;
    return toInvitation(row);
  }

  /**
   * Find invitation by token hash with SELECT FOR UPDATE (for concurrent acceptance).
   * Must be called within a transaction.
   */
  async findByTokenHashForUpdate(tx: any, tokenHash: string): Promise<WorkspaceInvitation | null> {
    const now = new Date();
    const rows = await tx.execute(
      sql`SELECT * FROM workspace_invitations WHERE token_hash = ${tokenHash} AND accepted_at IS NULL FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expires_at) < now) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      email: row.email,
      tokenHash: row.token_hash,
      type: row.type as 'email' | 'link',
      role: row.role,
      invitedBy: row.invited_by,
      expiresAt: new Date(row.expires_at),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
      createdAt: new Date(row.created_at),
    };
  }

  async findPendingByEmail(workspaceId: string, email: string): Promise<WorkspaceInvitation | null> {
    const rows = await db.select().from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
        isNull(workspaceInvitations.acceptedAt),
      ))
      .limit(1);
    return rows[0] ? toInvitation(rows[0]) : null;
  }

  async accept(id: string): Promise<void> {
    await db.update(workspaceInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(workspaceInvitations.id, id));
  }

  async deleteExpired(): Promise<number> {
    const result = await db.delete(workspaceInvitations)
      .where(and(
        lt(workspaceInvitations.expiresAt, new Date()),
        isNull(workspaceInvitations.acceptedAt),
      ))
      .returning({ id: workspaceInvitations.id });
    return result.length;
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await db.delete(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, workspaceId));
  }

  async listPending(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const now = new Date();
    const rows = await db.select().from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
      ));
    return rows.filter(r => r.expiresAt >= now).map(toInvitation);
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, id));
  }

  /** Hash a plaintext token for lookup */
  static hashToken(token: string): string {
    return hashToken(token);
  }
}

export const invitationsRepo = new InvitationsRepository();
```

- [ ] **Step 11: Run test to verify it passes**

Run: `bun test src/modules/members/__tests__/invitations.repo.test.ts`
Expected: PASS (note: `nanoid` must be installed — run `bun add nanoid` if not already present)

- [ ] **Step 12: Implement members.service.ts**

Replace `src/modules/members/members.service.ts`:

```typescript
import { db } from '../../infra/db/client';
import { workspaceMembers } from '../../infra/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { NotFoundError, ForbiddenError, ValidationError } from '../../core/errors';
import { membersRepo } from './members.repo';
import { invitationsRepo } from './invitations.repo';
import type { WorkspaceMember, InviteInput, MemberWithUser, WorkspaceInvitation } from './members.types';

class MembersService {
  async invite(workspaceId: string, input: InviteInput): Promise<{ token: string; invitation: WorkspaceInvitation }> {
    const type = input.email ? 'email' : 'link';

    // Check for duplicate pending invitation
    if (input.email) {
      const existing = await invitationsRepo.findPendingByEmail(workspaceId, input.email);
      if (existing) {
        throw new ValidationError(`Invitation already pending for ${input.email}`);
      }
    }

    const result = await invitationsRepo.create(workspaceId, {
      email: input.email,
      type,
      role: input.role ?? 'member',
      invitedBy: input.invitedBy,
    });

    eventBus.publish(Topics.MEMBER_INVITED, {
      workspaceId,
      email: input.email,
      type,
      role: input.role ?? 'member',
      invitedBy: input.invitedBy,
      invitationId: result.invitation.id,
    });

    return result;
  }

  async acceptInvitation(token: string, userId: string, userEmail: string): Promise<WorkspaceMember> {
    const tokenHash = invitationsRepo.constructor.hashToken
      ? (invitationsRepo.constructor as any).hashToken(token)
      : (() => { const h = new Bun.CryptoHasher('sha256'); h.update(token); return h.digest('hex'); })();

    return db.transaction(async (tx) => {
      // SELECT FOR UPDATE to prevent concurrent acceptance
      const invitation = await invitationsRepo.findByTokenHashForUpdate(tx, tokenHash);
      if (!invitation) {
        throw new NotFoundError('Invitation not found, expired, or already accepted');
      }

      // For email-type invitations: verify the accepting user's email matches
      if (invitation.type === 'email' && invitation.email) {
        if (userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
          throw new ForbiddenError('This invitation was sent to a different email address');
        }
      }

      // Check not already a member
      const existingMember = await membersRepo.findMember(invitation.workspaceId, userId);
      if (existingMember) {
        throw new ValidationError('Already a member of this workspace');
      }

      // Add member
      const member = await membersRepo.addMember(
        invitation.workspaceId,
        userId,
        invitation.role,
        invitation.invitedBy,
      );

      // Mark accepted
      await invitationsRepo.accept(invitation.id);

      eventBus.publish(Topics.MEMBER_JOINED, {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
      });

      return member;
    });
  }

  async removeMember(workspaceId: string, userId: string, removedBy: string): Promise<void> {
    return db.transaction(async (tx) => {
      // Lock the member rows for this workspace to prevent TOCTOU race
      const ownerRows = await tx.execute(
        sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND role = 'owner' FOR UPDATE`,
      );

      const member = await membersRepo.findMember(workspaceId, userId);
      if (!member) throw new NotFoundError('Member not found');

      // Prevent removing the last owner
      if (member.role === 'owner' && ownerRows.length <= 1) {
        throw new ForbiddenError('Cannot remove the last workspace owner');
      }

      await membersRepo.removeMember(workspaceId, userId);

      eventBus.publish(Topics.MEMBER_REMOVED, {
        workspaceId,
        userId,
        removedBy,
      });
    });
  }

  async updateRole(workspaceId: string, userId: string, newRole: string, changedBy: string): Promise<WorkspaceMember> {
    return db.transaction(async (tx) => {
      // Lock owner rows to prevent concurrent demotion of last owner
      const ownerRows = await tx.execute(
        sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND role = 'owner' FOR UPDATE`,
      );

      const member = await membersRepo.findMember(workspaceId, userId);
      if (!member) throw new NotFoundError('Member not found');

      // Prevent demoting the last owner
      if (member.role === 'owner' && newRole !== 'owner' && ownerRows.length <= 1) {
        throw new ForbiddenError('Cannot demote the last workspace owner');
      }

      const updated = await membersRepo.updateRole(workspaceId, userId, newRole);
      if (!updated) throw new NotFoundError('Member not found');

      eventBus.publish(Topics.MEMBER_ROLE_CHANGED, {
        workspaceId,
        userId,
        oldRole: member.role,
        newRole,
        changedBy,
      });

      return updated;
    });
  }

  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    return membersRepo.listMembers(workspaceId);
  }

  async listPendingInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return invitationsRepo.listPending(workspaceId);
  }
}

export const membersService = new MembersService();
```

- [ ] **Step 13: Implement members.routes.ts**

Replace `src/modules/members/members.routes.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { membersService } from './members.service';
import { createInvitationSchema, updateRoleSchema, memberUserIdParamSchema, invitationIdParamSchema } from './members.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

// --- Workspace-scoped member routes (mounted under /api/v1/workspaces/:workspaceId/members) ---

const listMembersRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'List members', ...jsonRes } },
});

const createInvitationRoute = createRoute({
  method: 'post', path: '/invitations',
  request: { body: { content: { 'application/json': { schema: createInvitationSchema } } } },
  responses: { 201: { description: 'Invitation created', ...jsonRes } },
});

const listInvitationsRoute = createRoute({
  method: 'get', path: '/invitations',
  responses: { 200: { description: 'List pending invitations', ...jsonRes } },
});

const revokeInvitationRoute = createRoute({
  method: 'delete', path: '/invitations/{id}',
  request: { params: invitationIdParamSchema },
  responses: { 204: { description: 'Invitation revoked' } },
});

const updateRoleRoute = createRoute({
  method: 'patch', path: '/{userId}/role',
  request: { params: memberUserIdParamSchema, body: { content: { 'application/json': { schema: updateRoleSchema } } } },
  responses: { 200: { description: 'Role updated', ...jsonRes } },
});

const removeMemberRoute = createRoute({
  method: 'delete', path: '/{userId}',
  request: { params: memberUserIdParamSchema },
  responses: { 204: { description: 'Member removed' } },
});

export const MembersRoutes = new OpenAPIHono();

MembersRoutes.openapi(listMembersRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const members = await membersService.listMembers(workspaceId);
  return c.json({ data: members });
});

MembersRoutes.openapi(createInvitationRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const workspaceRole = c.get('workspaceRole') as string;

  // Only admin+ can invite
  if (!['owner', 'admin'].includes(workspaceRole)) {
    return c.json({ error: 'Only admins can create invitations' }, 403);
  }

  const body = c.req.valid('json');
  const result = await membersService.invite(workspaceId, {
    email: body.email,
    role: body.role,
    invitedBy: callerId,
  });

  return c.json({ data: { token: result.token, invitation: result.invitation } }, 201);
});

MembersRoutes.openapi(listInvitationsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const workspaceRole = c.get('workspaceRole') as string;

  if (!['owner', 'admin'].includes(workspaceRole)) {
    return c.json({ error: 'Only admins can view invitations' }, 403);
  }

  const invitations = await membersService.listPendingInvitations(workspaceId);
  return c.json({ data: invitations });
});

MembersRoutes.openapi(revokeInvitationRoute, async (c) => {
  const workspaceRole = c.get('workspaceRole') as string;
  if (!['owner', 'admin'].includes(workspaceRole)) {
    return c.json({ error: 'Only admins can revoke invitations' }, 403);
  }
  const { id } = c.req.valid('param');
  const { invitationsRepo } = await import('./invitations.repo');
  await invitationsRepo.deleteById(id);
  return c.json({ success: true }, 204);
});

MembersRoutes.openapi(updateRoleRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const workspaceRole = c.get('workspaceRole') as string;

  if (workspaceRole !== 'owner') {
    return c.json({ error: 'Only owners can change roles' }, 403);
  }

  const { userId } = c.req.valid('param');
  const { role } = c.req.valid('json');
  const member = await membersService.updateRole(workspaceId, userId, role, callerId);
  return c.json({ data: member });
});

MembersRoutes.openapi(removeMemberRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const workspaceRole = c.get('workspaceRole') as string;
  const { userId } = c.req.valid('param');

  // Self-removal: any member can leave. Removing others: admin+
  if (userId !== callerId && !['owner', 'admin'].includes(workspaceRole)) {
    return c.json({ error: 'Only admins can remove other members' }, 403);
  }

  await membersService.removeMember(workspaceId, userId, callerId);
  return c.json({ success: true }, 204);
});
```

- [ ] **Step 14: Update index.ts**

Replace `src/modules/members/index.ts`:

```typescript
export { membersRepo } from './members.repo';
export { invitationsRepo } from './invitations.repo';
export { membersService } from './members.service';
export { MembersRoutes } from './members.routes';
export type { WorkspaceMember, WorkspaceInvitation, MemberWithUser, InviteInput } from './members.types';
export type { InvitationDeliveryProvider } from './members.providers';
```

- [ ] **Step 15: Delete unused stub files**

```bash
rm src/modules/members/members.controller.ts src/modules/members/members.mapper.ts src/modules/members/members.events.ts
```

- [ ] **Step 16: Run all members tests**

Run: `bun test src/modules/members/__tests__/`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
git add src/modules/members/
git commit -m "feat: implement members module — invitations with hashed tokens, row locking, role protection"
```

---

### Task 7: Clerk Webhook Handler

**Files:**
- Create: `src/api/routes/webhooks/clerk.ts`
- Test: `src/api/routes/webhooks/__tests__/clerk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api/routes/webhooks/__tests__/clerk.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Test the webhook route handling without real Clerk verification
describe('Clerk webhook handler', () => {
  it('returns 501 when CLERK_WEBHOOK_SECRET is not set', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    // Dynamic import to pick up env change
    const { clerkWebhookRoutes } = await import('../clerk');
    const app = clerkWebhookRoutes;

    const res = await app.request('/', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(501);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/routes/webhooks/__tests__/clerk.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement clerk.ts**

Create `src/api/routes/webhooks/clerk.ts`:

```typescript
import { OpenAPIHono } from '@hono/zod-openapi';
import { usersService } from '../../../modules/users/users.service';
import { logger } from '../../../config/logger';
import type { ClerkWebhookEvent } from '../../../modules/users/users.types';

export const clerkWebhookRoutes = new OpenAPIHono();

clerkWebhookRoutes.post('/', async (c) => {
  const secret = Bun.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: 'Webhook verification not configured' }, 501);
  }

  // Get raw body for signature verification
  const payload = await c.req.text();
  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: 'Missing webhook signature headers' }, 400);
  }

  // Verify webhook signature
  let event: ClerkWebhookEvent;
  try {
    // Try @clerk/backend first, fall back to svix
    let Webhook: any;
    try {
      const clerk = await import('@clerk/backend');
      Webhook = (clerk as any).Webhook;
    } catch {
      const svix = await import('svix');
      Webhook = svix.Webhook;
    }

    const wh = new Webhook(secret);
    event = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    logger.warn({ err }, 'Clerk webhook: signature verification failed');
    return c.json({ error: 'Invalid webhook signature' }, 401);
  }

  // Process the event
  try {
    await usersService.syncFromClerk(event);
    logger.info({ type: event.type, userId: event.data.id }, 'Clerk webhook processed');
    return c.json({ received: true });
  } catch (err) {
    logger.error({ err, type: event.type }, 'Clerk webhook: processing failed');
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/api/routes/webhooks/__tests__/clerk.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/webhooks/
git commit -m "feat: add Clerk webhook handler with signature verification"
```

---

### Task 8: Invitation Accept Routes (Top-Level)

**Files:**
- Create: `src/api/routes/invitations.ts`
- Test: (covered by integration tests in Task 10)

- [ ] **Step 1: Create invitation accept routes**

Create `src/api/routes/invitations.ts`:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth';
import { invitationsRepo } from '../../modules/members/invitations.repo';
import { membersService } from '../../modules/members/members.service';
import { invitationTokenParamSchema } from '../../modules/members/members.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const validateTokenRoute = createRoute({
  method: 'get', path: '/{token}',
  request: { params: invitationTokenParamSchema },
  responses: {
    200: { description: 'Invitation details (public)', ...jsonRes },
    404: { description: 'Invitation not found or expired' },
  },
});

const acceptRoute = createRoute({
  method: 'post', path: '/{token}/accept',
  request: { params: invitationTokenParamSchema },
  responses: {
    200: { description: 'Invitation accepted', ...jsonRes },
    404: { description: 'Invitation not found or expired' },
  },
});

export const invitationRoutes = new OpenAPIHono();

// GET /api/v1/invitations/:token — public (no auth), for pre-auth UI
invitationRoutes.openapi(validateTokenRoute, async (c) => {
  const { token } = c.req.valid('param');
  const tokenHash = (() => { const h = new Bun.CryptoHasher('sha256'); h.update(token); return h.digest('hex'); })();
  const invitation = await invitationsRepo.findByTokenHash(tokenHash);
  if (!invitation) {
    return c.json({ error: 'Invitation not found or expired' }, 404);
  }

  // Return limited info (no token hash, no internal IDs)
  const { workspacesRepo } = await import('../../modules/workspaces/workspaces.repo');
  const workspace = await workspacesRepo.findById(invitation.workspaceId);

  return c.json({
    data: {
      workspaceName: workspace?.name ?? 'Unknown',
      role: invitation.role,
      type: invitation.type,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });
});

// POST /api/v1/invitations/:token/accept — requires auth
invitationRoutes.use('/:token/accept', authMiddleware);

invitationRoutes.openapi(acceptRoute, async (c) => {
  const { token } = c.req.valid('param');
  const callerId = c.get('callerId') as string;

  // Get user email from Clerk JWT claims or user table
  const { usersRepo } = await import('../../modules/users/users.repo');
  const user = await usersRepo.findById(callerId);
  const userEmail = user?.email ?? '';

  const member = await membersService.acceptInvitation(token, callerId, userEmail);
  return c.json({ data: member });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/api/routes/invitations.ts
git commit -m "feat: add invitation validation and acceptance routes"
```

---

### Task 9: Route Mounting + Auth lastSeenAt

**Files:**
- Modify: `src/app/create-app.ts`
- Modify: `src/api/routes/workspace/index.ts`
- Modify: `src/api/middlewares/auth.ts`

- [ ] **Step 1: Mount members routes in workspace router**

In `src/api/routes/workspace/index.ts`, add the import and route mount:

Add import:
```typescript
import { MembersRoutes } from '../../../modules/members';
```

Add route mount after the last `workspaceRoutes.route(...)` line (after feature-flags):
```typescript
workspaceRoutes.route('/members', MembersRoutes);
```

- [ ] **Step 2: Mount webhook, workspace-management, and invitation routes in create-app.ts**

In `src/app/create-app.ts`, add imports:

```typescript
import { clerkWebhookRoutes } from '../api/routes/webhooks/clerk';
import { WorkspacesRoutes } from '../modules/workspaces';
import { invitationRoutes } from '../api/routes/invitations';
```

Add routes after the `app.route('/', publicRoutes);` line and before the workspace-scoped routes:

```typescript
  // Clerk webhooks (no auth — verified by Svix signature)
  app.route('/webhooks/clerk', clerkWebhookRoutes);

  // Workspace management (auth required, not workspace-scoped)
  app.route('/api/v1/workspace-management', WorkspacesRoutes);

  // Invitation routes (GET is public, POST /accept requires auth)
  app.route('/api/v1/invitations', invitationRoutes);
```

- [ ] **Step 3: Add lastSeenAt fire-and-forget update in auth middleware**

In `src/api/middlewares/auth.ts`, add import at top:

```typescript
import { usersRepo } from '../../modules/users/users.repo';
```

After the JWT auth success block (after `c.set('callerRole', ...)` in both Clerk and dev-fallback paths), add a fire-and-forget update. Specifically, right before `return next();` in both JWT paths, add:

```typescript
      // Fire-and-forget: update lastSeenAt
      usersRepo.updateLastSeen(payload.sub ?? 'dev-user').catch(() => {});
```

For the Clerk path (inside the `try` block, after `c.set('callerRole', ...)`):
```typescript
      usersRepo.updateLastSeen(payload.sub).catch(() => {});
```

For the dev-fallback path (after `c.set('callerRole', ...)`):
```typescript
      usersRepo.updateLastSeen(payload.sub ?? 'dev-user').catch(() => {});
```

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add src/app/create-app.ts src/api/routes/workspace/index.ts src/api/middlewares/auth.ts src/api/routes/invitations.ts
git commit -m "feat: mount foundation routes — webhooks, workspace management, members, invitations"
```

---

### Task 10: Cleanup Job Updates

**Files:**
- Modify: `src/jobs/cleanup/index.ts`

- [ ] **Step 1: Add invitation cleanup and workspace hard-delete steps**

In `src/jobs/cleanup/index.ts`, add imports at the top:

```typescript
import { invitationsRepo } from '../../modules/members/invitations.repo';
import { workspacesRepo } from '../../modules/workspaces/workspaces.repo';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { db } from '../../infra/db/client';
import { workspaceMembers, workspaceSettings, workspaceInvitations, agentConfigs, a2aTasks, sessions, agentMemories, memoryProposals, orchestrations, apiKeys as apiKeysTable, workflowTemplates, usageRecords, registeredAgents, skillDefinitions, mcpServerConfigs } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
```

Add two new steps at the end of `runCleanup()`:

```typescript
  // Clean up expired invitations
  try {
    const deleted = await invitationsRepo.deleteExpired();
    if (deleted > 0) logger.info({ count: deleted }, 'Cleanup: deleted expired invitations');
  } catch (err) {
    logger.error({ err }, 'Cleanup: expired invitations step failed');
  }

  // Hard-delete soft-deleted workspaces past grace period (30 days)
  try {
    const staleWorkspaces = await workspacesRepo.findSoftDeleted(30);
    for (const ws of staleWorkspaces) {
      try {
        await db.transaction(async (tx) => {
          // Delete child rows in dependency order
          // Tables with FK → agentConfigs must go before agentConfigs
          await tx.delete(usageRecords).where(eq(usageRecords.workspaceId, ws.id));
          await tx.delete(memoryProposals).where(eq(memoryProposals.workspaceId, ws.id));
          await tx.delete(agentMemories).where(eq(agentMemories.workspaceId, ws.id));
          await tx.delete(orchestrations).where(eq(orchestrations.workspaceId, ws.id));
          await tx.delete(a2aTasks).where(eq(a2aTasks.workspaceId, ws.id));
          await tx.delete(sessions).where(eq(sessions.workspaceId, ws.id));
          await tx.delete(agentConfigs).where(eq(agentConfigs.workspaceId, ws.id));
          await tx.delete(workflowTemplates).where(eq(workflowTemplates.workspaceId, ws.id));
          await tx.delete(registeredAgents).where(eq(registeredAgents.workspaceId, ws.id));
          await tx.delete(apiKeysTable).where(eq(apiKeysTable.workspaceId, ws.id));
          await tx.delete(skillDefinitions).where(eq(skillDefinitions.workspaceId, ws.id));
          await tx.delete(mcpServerConfigs).where(eq(mcpServerConfigs.workspaceId, ws.id));
          // CASCADE tables (workspace_members, workspace_settings, workspace_invitations) auto-delete
          // Hard-delete the workspace row
          await tx.delete((await import('../../infra/db/schema')).workspaces).where(eq((await import('../../infra/db/schema')).workspaces.id, ws.id));
        });
        eventBus.publish(Topics.WORKSPACE_DELETED, { workspaceId: ws.id });
        logger.info({ workspaceId: ws.id }, 'Cleanup: hard-deleted workspace');
      } catch (err) {
        logger.warn({ workspaceId: ws.id, err }, 'Cleanup: workspace hard-delete failed (RESTRICT?), will retry next cycle');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup: workspace hard-delete step failed');
  }
```

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/jobs/cleanup/index.ts
git commit -m "feat: add invitation cleanup and workspace hard-delete to cleanup job"
```

---

### Task 11: Delete Stub Modules

**Files:**
- Delete: `src/modules/auth/` (all 9 files)
- Delete: `src/modules/roles/` (all 9 files)
- Delete: `src/modules/permissions/` (all 9 files)

- [ ] **Step 1: Verify no imports exist**

Run: `grep -r "modules/auth\|modules/roles\|modules/permissions" src/ --include="*.ts" | grep -v "node_modules" | grep "import"`

Expected: No output (no imports of these stub modules)

- [ ] **Step 2: Delete stub directories**

```bash
rm -rf src/modules/auth/ src/modules/roles/ src/modules/permissions/
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: PASS (nothing depended on these stubs)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete empty auth, roles, permissions stub modules"
```

---

### Task 12: Seed Script Update

**Files:**
- Modify: `scripts/create-admin.ts`

- [ ] **Step 1: Read current seed script**

Read `scripts/create-admin.ts` to understand the current implementation.

- [ ] **Step 2: Refactor to use repo methods**

Update `scripts/create-admin.ts` to use `workspacesRepo` and `membersRepo` directly (not the service layer, to avoid EventBus dependency):

```typescript
import { db } from '../src/infra/db/client';
import { workspaces, workspaceMembers } from '../src/infra/db/schema';
import { eq } from 'drizzle-orm';

const DEFAULT_ADMIN_ID = Bun.env.SEED_ADMIN_USER_ID ?? 'user_dev_admin';

async function createAdmin() {
  console.log('Seeding default workspaces...');

  // Default workspace
  const [defaultWs] = await db.insert(workspaces).values({
    name: 'Default',
    slug: 'default',
    createdBy: DEFAULT_ADMIN_ID,
  }).onConflictDoNothing({ target: workspaces.slug }).returning();

  if (defaultWs) {
    await db.insert(workspaceMembers).values({
      workspaceId: defaultWs.id,
      userId: DEFAULT_ADMIN_ID,
      role: 'owner',
    }).onConflictDoNothing();
    console.log(`  Created "default" workspace (${defaultWs.id})`);
  } else {
    console.log('  "default" workspace already exists');
  }

  // Public workspace (for MCP dev-mode and A2A fallback)
  const [publicWs] = await db.insert(workspaces).values({
    name: 'Public',
    slug: 'public',
    createdBy: DEFAULT_ADMIN_ID,
  }).onConflictDoNothing({ target: workspaces.slug }).returning();

  if (publicWs) {
    await db.insert(workspaceMembers).values({
      workspaceId: publicWs.id,
      userId: DEFAULT_ADMIN_ID,
      role: 'owner',
    }).onConflictDoNothing();
    console.log(`  Created "public" workspace (${publicWs.id})`);
  } else {
    console.log('  "public" workspace already exists');
  }

  console.log('Done.');
  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Test the seed script**

Run: `bun run scripts/create-admin.ts`
Expected: Prints workspace creation messages, exits 0

- [ ] **Step 4: Commit**

```bash
git add scripts/create-admin.ts
git commit -m "refactor: seed script uses repo layer directly, avoids EventBus dependency"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `bun test` — all tests pass
- [ ] `bun run db:generate` — no pending migrations
- [ ] `bun run build` — builds without errors
- [ ] Manual: POST `/api/v1/workspace-management` creates workspace + owner member in one transaction
- [ ] Manual: POST `/api/v1/workspaces/:id/members/invitations` creates invitation, returns token
- [ ] Manual: GET `/api/v1/invitations/:token` returns workspace name + role (no auth needed)
- [ ] Manual: POST `/api/v1/invitations/:token/accept` adds member (with auth)
- [ ] Manual: DELETE `/api/v1/workspace-management/:id` soft-deletes, workspace becomes inaccessible
- [ ] Manual: Workspace middleware returns `workspaceRole` alongside `callerRole`
