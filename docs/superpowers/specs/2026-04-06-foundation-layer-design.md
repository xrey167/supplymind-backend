# Foundation Layer: Auth, Users, Workspaces, Members

**Goal:** Make the backend multi-tenant-complete by implementing user sync, workspace CRUD, member management with invitations, and fixing the role model — while keeping all domain-specific behavior pluggable via events and provider interfaces.

**Architecture:** The foundation layer is pure infrastructure — it owns identity, tenancy, and access control. Domain-specific side effects (notifications, billing, onboarding) are triggered via EventBus events and provider interfaces. The foundation doesn't know what's listening.

**Tech Stack:** Clerk (auth provider, `@clerk/backend` for webhook verification), Drizzle ORM (Postgres), existing EventBus, existing BullMQ cleanup job.

---

## 1. Role Model Reconciliation

### Problem

Two incompatible role enums exist:

- **RBAC system** (`roleEnum`): `system | admin | operator | agent | viewer` — numeric hierarchy (50/40/30/20/10), used by API keys, skill permissions, gateway ops
- **Workspace members** (`workspaceRoleEnum`): `owner | admin | member | viewer` — used in `workspace_members` table

The workspace middleware overwrites `callerRole` with the workspace role string. Since `owner` and `member` don't exist in the RBAC level map, `hasPermission()` returns `false` for these values. This is a **live bug**.

### Solution

Two-tier role model with explicit mapping at the middleware boundary.

**`src/core/security/rbac.ts`** — add mapping function:

```typescript
const WORKSPACE_ROLE_MAP: Record<string, Role> = {
  owner: 'admin',
  admin: 'admin',
  member: 'operator',
  viewer: 'viewer',
};

export function mapWorkspaceRole(workspaceRole: string): Role {
  return WORKSPACE_ROLE_MAP[workspaceRole] ?? 'viewer';
}

// Preserves original workspace role alongside mapped RBAC role
export interface ResolvedRoles {
  callerRole: Role;           // mapped RBAC role for permission checks
  workspaceRole: string;      // original workspace role (owner|admin|member|viewer)
}
```

**`src/api/middlewares/workspace.ts`** — call `mapWorkspaceRole(row.role)` and store **both** roles in context:

```typescript
c.set('callerRole', mapWorkspaceRole(row.role));   // RBAC role for permission checks
c.set('workspaceRole', row.role);                   // original role for owner-specific logic
```

This preserves the owner/admin distinction. Routes that need to differentiate (e.g. workspace deletion, role management) check `workspaceRole === 'owner'` directly. All permission checks use `callerRole` (the mapped RBAC role).

Workspace roles are a tenant concept (who manages this workspace). RBAC roles are a capability concept (what can this caller do). They're separate axes:

| Workspace Role | RBAC Role | Level | Rationale |
|---|---|---|---|
| `owner` | `admin` (40) | Full workspace control |
| `admin` | `admin` (40) | Same |
| `member` | `operator` (30) | Can use agents, run tasks, invoke skills |
| `viewer` | `viewer` (10) | Read-only |

`system` (50) and `agent` (20) remain internal-only — used by the orchestration engine and AI agents, never assigned to workspace members.

**API key auth path:** API keys bypass the workspace middleware and use their RBAC role directly. However, the API key middleware must also check `workspaces.deletedAt IS NULL` for the resolved workspace — otherwise API keys can access soft-deleted workspaces.

### Test Impact

`src/api/middlewares/__tests__/workspace.test.ts` asserts `role === 'member'`. After the mapping, this becomes `role === 'operator'`. Update the test.

---

## 2. Users Sync Table

### Schema

New table `users`:

| Column | Type | Constraints |
|---|---|---|
| `id` | text | PK (Clerk userId, e.g. `user_2x7...`) |
| `email` | text | unique, not null |
| `name` | text | nullable |
| `avatarUrl` | text | nullable |
| `lastSeenAt` | timestamp | nullable |
| `createdAt` | timestamp | default now() |
| `updatedAt` | timestamp | default now() |

No FK from `workspace_members.userId` to `users.id`. They are loosely coupled — both keyed by Clerk `userId` but no hard dependency. If a Clerk webhook is delayed, membership still works. If a user exists in `workspace_members` but not in `users`, display falls back to the raw userId string.

### Clerk Webhook Handler

**Route:** `POST /webhooks/clerk` — mounted at top level in `create-app.ts`, outside auth middleware. Verified by Svix signature, not by Bearer token.

**New env var:** `CLERK_WEBHOOK_SECRET: z.string().optional()` — if unset, endpoint returns 501 Not Implemented.

**Events handled:**

| Clerk Event | Action |
|---|---|
| `user.created` | Upsert into `users` table |
| `user.updated` | Upsert into `users` table |
| `user.deleted` | Delete from `users` table. Also: find workspaces where this user is the **sole owner** → soft-delete those workspaces (emitting `workspace.deleting`). This prevents orphaned workspaces with no owner. |

Webhook verification uses `@clerk/backend`'s `Webhook` class (re-exported from `svix` internally — no separate `svix` install needed). Access raw body via `c.req.raw` before any body parsing.

```typescript
import { Webhook } from '@clerk/backend';

const wh = new Webhook(Bun.env.CLERK_WEBHOOK_SECRET!);
const payload = await c.req.text();
const headers = Object.fromEntries(c.req.raw.headers.entries());
const event = wh.verify(payload, headers);
```

If `@clerk/backend` does not re-export `Webhook`, fall back to installing `svix` directly as a dependency.

### User Repo

Four methods, no service-layer business logic beyond event emission:

- `upsert(id, email, name?, avatarUrl?)` — insert on conflict update
- `findById(id)` — single user
- `findByEmail(email)` — for invitation resolution
- `delete(id)` — hard delete (Clerk is source of truth)

### User Service

- `syncFromClerk(clerkEvent)` — routes to upsert/delete, emits `user.synced` / `user.deleted`

### lastSeenAt

The auth middleware already runs on every request. After successful JWT auth, fire-and-forget update `users.lastSeenAt`. Same pattern as `api_keys.lastUsedAt`.

### No User CRUD Routes

Users are managed in Clerk. The backend is a read-only sync. No user management API exposed.

---

## 3. Workspaces CRUD

### Repo

`src/modules/workspaces/workspaces.repo.ts`:

- `create(name, slug, createdBy)` → insert, return workspace
- `findById(id)` → single workspace (filters `deletedAt IS NULL`)
- `findBySlug(slug)` → single workspace (filters `deletedAt IS NULL`)
- `findByUserId(userId)` → all workspaces where user is a member (joins `workspace_members`, filters `deletedAt IS NULL`)
- `update(id, { name?, slug? })` → partial update
- `softDelete(id)` → set `deletedAt = now()`
- `restore(id)` → set `deletedAt = null`
- `findSoftDeleted(olderThanDays)` → for hard-delete job
- `hardDelete(id)` → actual DELETE (only called by cleanup job after grace period)

### Service

`src/modules/workspaces/workspaces.service.ts`:

- `create(name, userId)` → **in a transaction**: generates slug, creates workspace, adds creator as `owner` in `workspace_members`; after commit emits `workspace.created`
- `getById(id)` / `getBySlug(slug)` → returns workspace or throws NotFoundError
- `listForUser(userId)` → all workspaces the user belongs to
- `update(id, { name?, slug? })` → validates slug uniqueness, emits `workspace.updated`
- `delete(id, deletedBy)` → soft-delete, emits `workspace.deleting` (modules clean up their data)

### Slug Generation

Lowercase, hyphenated, special chars stripped. On unique constraint violation, appends a 4-char random suffix (e.g. `acme-corp-x7k3`). No external library.

```typescript
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

Collision handling: catch unique constraint error, retry with suffix (up to 3 attempts).

### Routes

**Workspace management** routes are mounted at `/api/v1/workspace-management` to avoid routing conflict with the existing workspace-scoped mount at `/api/v1/workspaces/:workspaceId/*`:

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/workspace-management` | authenticated user | Create workspace |
| `GET` | `/api/v1/workspace-management` | authenticated user | List user's workspaces |
| `GET` | `/api/v1/workspace-management/:workspaceId` | workspace member | Get workspace details |
| `PATCH` | `/api/v1/workspace-management/:workspaceId` | workspace `owner`/`admin` | Update name/slug |
| `DELETE` | `/api/v1/workspace-management/:workspaceId` | workspace `owner` (checks `workspaceRole`) | Soft-delete workspace |

The existing workspace-scoped routes (`/api/v1/workspaces/:workspaceId/agents`, etc.) stay exactly where they are.

### Events

- `workspace.created` — `{ workspaceId, name, slug, createdBy }`
- `workspace.updated` — `{ workspaceId, changes }`
- `workspace.deleting` — `{ workspaceId, deletedBy }` — modules react to clean up their data
- `workspace.deleted` — `{ workspaceId }` — emitted after hard delete (informational)

---

## 4. Workspace Deletion Strategy

### Approach: RESTRICT FKs + Soft-Delete + Event-Driven Cleanup

Three layers working together:

**Layer 1 — DB constraints (safety net):**

Add `ON DELETE RESTRICT` FK from all workspace-scoped tables to `workspaces.id`. This prevents accidental hard deletes — the DB refuses to delete a workspace that still has child rows. Migration uses `NOT VALID` + separate `VALIDATE CONSTRAINT` to avoid table locks.

Tables receiving FK constraints:

| Table | workspaceId nullable? | FK action |
|---|---|---|
| `agent_configs` | no | RESTRICT |
| `a2a_tasks` | no | RESTRICT |
| `sessions` | no | RESTRICT |
| `agent_memories` | no | RESTRICT |
| `memory_proposals` | no | RESTRICT |
| `orchestrations` | no | RESTRICT |
| `api_keys` | no | RESTRICT |
| `workflow_templates` | no | RESTRICT |
| `usage_records` | no | RESTRICT |
| `registered_agents` | no | RESTRICT |
| `skill_definitions` | nullable | SET NULL |
| `mcp_server_configs` | nullable | SET NULL |

`workspace_members` already has a CASCADE FK — leave as-is. `workspace_settings` currently has **no FK** — add `ON DELETE CASCADE` FK to `workspaces.id` in the migration. Both should be deleted with the workspace.

**Layer 2 — Soft-delete (user-facing):**

Add `deletedAt: timestamp, nullable` to `workspaces` table. The workspace middleware checks `deletedAt IS NULL` — one check, one place. No `WHERE deletedAt IS NULL` scattered across repos.

When a user "deletes" a workspace:
1. Service sets `deletedAt = now()`
2. Emits `workspace.deleting` event
3. Workspace becomes immediately inaccessible via middleware
4. All data persists (recoverable)

**Layer 3 — Hard-delete job (background):**

Added to the existing cleanup cron (runs every 15 minutes):
1. Find workspaces where `deletedAt < 30 days ago`
2. For each workspace, **in a transaction**:
   a. Delete child rows table by table in dependency order (sessions → tasks → agents, etc.)
   b. Track which tables were successfully cleared (idempotent — skips already-empty tables on retry)
   c. Hard-delete the workspace row
   d. If RESTRICT blocks it (some module didn't clean up), **rollback transaction**, log warning with the blocking table, retry next cycle
3. Emit `workspace.deleted` event after successful hard delete

Modules can also register cleanup handlers on `workspace.deleting` for immediate side-effect cleanup (revoke external API keys, delete S3 files, notify integrations). The hard-delete job is the safety net.

---

## 5. Members + Invitations

### New Table `workspace_invitations`

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | PK |
| `workspaceId` | uuid | FK → workspaces (CASCADE) |
| `email` | text | nullable (null for link-only invites) |
| `tokenHash` | text | unique (SHA-256 of nanoid token — plaintext never stored) |
| `type` | text | `'email'` or `'link'` |
| `role` | workspaceRoleEnum | the role they'll get on join |
| `invitedBy` | text | userId |
| `expiresAt` | timestamp | default: 7 days from creation |
| `acceptedAt` | timestamp | nullable |
| `createdAt` | timestamp | default now() |

Unique constraint on `(workspaceId, email)` where email is not null.

### Members Repo

`src/modules/members/members.repo.ts`:

- `addMember(workspaceId, userId, role, invitedBy?)` → insert
- `findMember(workspaceId, userId)` → single member
- `listMembers(workspaceId)` → all members, left-joins `users` for display name/email
- `updateRole(workspaceId, userId, role)` → update
- `removeMember(workspaceId, userId)` → delete
- `countMembers(workspaceId)` → count

### Invitations Repo

`src/modules/members/invitations.repo.ts`:

- `create(workspaceId, { email?, type, role, invitedBy, expiresAt })` → generates nanoid token, stores SHA-256 hash in `tokenHash`, returns plaintext token to caller (shown once)
- `findByTokenHash(tokenHash)` → single invitation (not expired, not accepted) — caller hashes the input token before querying
- `findPendingByEmail(workspaceId, email)` → duplicate check
- `accept(id)` → set `acceptedAt = now()`
- `deleteExpired()` → cleanup (added to existing cleanup job)
- `deleteByWorkspace(workspaceId)` → for workspace deletion cleanup

### Members Service

`src/modules/members/members.service.ts`:

- `invite(workspaceId, { email?, role, invitedBy })` → creates invitation record, emits `member.invited`. If email provided, type is `email`; otherwise type is `link`. **The service does not send emails** — it emits the event. A notification plugin listens and delivers.
- `createInviteLink(workspaceId, { role, invitedBy })` → creates link-type invitation, returns token
- `acceptInvitation(token, userId, userEmail)` → **in a transaction with `SELECT ... FOR UPDATE` on the invitation row**: validates token, checks expiry, checks not already accepted, checks not already a member. For `email`-type invitations: **verifies `userEmail` matches `invitation.email`** (prevents wrong-user acceptance). Adds member, marks accepted, emits `member.joined`.
- `removeMember(workspaceId, userId, removedBy)` → **in a transaction with `SELECT ... FOR UPDATE` on workspace_members**: counts owners, prevents removing the last `owner`, emits `member.removed`
- `updateRole(workspaceId, userId, newRole, changedBy)` → **in a transaction with `SELECT ... FOR UPDATE`**: if demoting from `owner`, counts remaining owners first (atomic — no TOCTOU race), emits `member.role_changed`
- `listMembers(workspaceId)` → members with display info from `users` table
- `listPendingInvitations(workspaceId)` → unaccepted, non-expired invitations

### Provider Interface

`src/modules/members/members.providers.ts`:

```typescript
export interface InvitationDeliveryProvider {
  deliver(invitation: WorkspaceInvitation, workspace: Workspace): Promise<void>;
}
```

The service doesn't call this. A consumer listens to `member.invited` and calls whatever provider is registered. Foundation ships with no provider — invitations work via link by default, email delivery is opt-in.

### Routes

Workspace-scoped, mounted at `/api/v1/workspaces/:workspaceId/members`:

| Method | Path | Required Role | Description |
|---|---|---|---|
| `GET` | `/` | `viewer` | List members |
| `POST` | `/invitations` | `admin` | Create invitation |
| `GET` | `/invitations` | `admin` | List pending invitations |
| `DELETE` | `/invitations/:id` | `admin` | Revoke invitation |
| `PATCH` | `/:userId/role` | `owner` | Change member role |
| `DELETE` | `/:userId` | `admin` (self-remove: any) | Remove member |

Top-level invitation routes (not workspace-scoped):

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/invitations/:token` | none (public) | Validate token — returns workspace name, role, expiry status (for pre-auth UI) |
| `POST` | `/api/v1/invitations/:token/accept` | authenticated user | Accept invitation (passes `userId` and `userEmail` from JWT) |

### Cleanup Integration

Add `invitationsRepo.deleteExpired()` to the existing cleanup job step list.

---

## 6. Event Topics

New topics added to `src/events/topics.ts`:

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

Redis pub/sub bridge in bootstrap: add `workspace.#` and `member.#` patterns.

---

## 7. Stub Cleanup

Delete these empty modules — verified no external imports:

| Module | Real location |
|---|---|
| `src/modules/auth/` (8 files) | `src/infra/auth/` + `src/api/middlewares/auth.ts` |
| `src/modules/roles/` (8 files) | `src/core/security/rbac.ts` |
| `src/modules/permissions/` (8 files) | `src/api/middlewares/permissions.ts` |

~24 files removed.

---

## 8. Seed Script Updates

- `scripts/create-admin.ts` refactored to use repo methods directly (not service layer — avoids EventBus bootstrap dependency)
- Uses `workspacesRepo.create()` and `membersRepo.addMember()` to insert `default` and `public` workspace records
- No EventBus events emitted during seeding — acceptable for bootstrap data

---

## 9. Deployment Notes

- **Clerk JWT custom claims:** Must include `workspaceId` in JWT metadata for JWT-authenticated MCP/A2A calls to resolve workspace context. Configured in Clerk dashboard.
- **`CLERK_WEBHOOK_SECRET`:** Must be set in production for webhook verification. Obtain from Clerk dashboard → Webhooks.
- **Webhook verification:** Uses `@clerk/backend` Webhook class. If not available, install `svix` as a direct dependency.

---

## Files Modified/Created

| File | Change |
|---|---|
| `src/core/security/rbac.ts` | Add `mapWorkspaceRole()` |
| `src/api/middlewares/workspace.ts` | Call `mapWorkspaceRole()` |
| `src/api/middlewares/auth.ts` | Add `lastSeenAt` update for JWT users |
| `src/infra/db/schema/index.ts` | Add `users` table, `workspace_invitations` table, `deletedAt` on workspaces, FK constraints |
| `src/modules/users/users.repo.ts` | Replace stub — upsert, find, delete |
| `src/modules/users/users.service.ts` | Replace stub — syncFromClerk |
| `src/modules/workspaces/workspaces.repo.ts` | Replace stub — full CRUD + soft-delete |
| `src/modules/workspaces/workspaces.service.ts` | Replace stub — CRUD + slug + events |
| `src/modules/workspaces/workspaces.routes.ts` | Replace stub — 5 routes |
| `src/modules/members/members.repo.ts` | Replace stub — member CRUD |
| `src/modules/members/invitations.repo.ts` | **New** — invitation CRUD |
| `src/modules/members/members.service.ts` | Replace stub — invite, accept, remove, role change |
| `src/modules/members/members.routes.ts` | Replace stub — 6 routes + invitation accept |
| `src/modules/members/members.providers.ts` | **New** — `InvitationDeliveryProvider` interface |
| `src/modules/members/members.routes.ts` | Replace stub — 6 member routes + invitation accept |
| `src/api/routes/webhooks/index.ts` | Replace stub — Clerk webhook handler |
| `src/api/routes/workspace/index.ts` | Mount members routes under workspace-scoped router |
| `src/app/create-app.ts` | Mount webhook routes, workspace management routes, invitation routes |
| `src/events/topics.ts` | Add 10 new topics |
| `src/config/env.ts` | Add `CLERK_WEBHOOK_SECRET` |
| `src/jobs/cleanup/index.ts` | Add expired invitation cleanup + workspace hard-delete steps |
| `scripts/create-admin.ts` | Refactor to use workspace service |
| `src/modules/auth/*` | **Delete** |
| `src/modules/roles/*` | **Delete** |
| `src/modules/permissions/*` | **Delete** |
| `src/api/middlewares/__tests__/workspace.test.ts` | Update role assertion |
