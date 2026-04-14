# Agents Guide

Instructions for AI agents working on this codebase.

## Stack

- **Runtime**: Bun (not Node.js) — use Bun APIs, not Node.js equivalents
- **Framework**: Hono + `@hono/zod-openapi`
- **Language**: TypeScript (strict mode, ESNext target)
- **DB**: Drizzle ORM + PostgreSQL (pgvector for embeddings)
- **Queue**: BullMQ + Redis
- **Auth**: Clerk (webhook-synced users) + API key auth
- **AI**: Anthropic, OpenAI, Google GenAI (multi-provider with fallback)
- **Tests**: `bun:test` (`describe`/`it`/`expect` — not vitest/jest)
- **Validation**: Zod v4 (not v3 — API differs)

## Critical Rules

1. **Use `AppEnv`** — all `OpenAPIHono` instances must be `new OpenAPIHono<AppEnv>()` with the import from `src/core/types/env.ts`. This types context variables (`workspaceId`, `callerId`, `callerRole`, `workspaceRole`, `userId`).

2. **Declare error responses** — route definitions must include all status codes the handler returns (400, 404, 500, etc.), not just the success code. Use the `errRes` helper pattern:
   ```ts
   const errRes = (desc: string) => ({ description: desc, ...jsonRes });
   ```

3. **Wrap list responses** — handlers returning arrays must wrap in `{ data: [...] }`, not return bare arrays.

4. **204 = no body** — use `c.body(null, 204)`, never `c.json({...}, 204)`.

5. **Zod v4** — not v3. API differs (e.g., `z.object({}).passthrough()` not `.catchall()`).

6. **Plugin status** — `plugin_installations.status` is an enum (`'active'`, `'disabled'`), not a boolean `enabled`.

7. **Tests alongside source** — place unit tests in `__tests__/` dirs next to the code when adding new coverage. The top-level `tests/` dir is currently used for integration, e2e, and some legacy/unit suites.

8. **No domain code in core/infra** — `src/core/`, `src/infra/`, and `src/events/` are domain-agnostic. Domain-specific logic belongs in `src/modules/` or `src/plugins/`.

9. **Result types** — use `Result<T, E>` from `src/core/result/` for operations that can fail. Avoid throwing exceptions for expected error paths.

10. **Unified gateway** — all operations (skill invocation, task management, agent calls) flow through the gateway's `execute()` function regardless of transport protocol.

## Module Structure

Each domain module in `src/modules/` follows this layout:

```
modules/<name>/
  <name>.routes.ts     # OpenAPI route definitions + handlers
  <name>.service.ts    # Business logic
  <name>.repo.ts       # Database queries (Drizzle)
  <name>.schemas.ts    # Zod validation schemas
  <name>.mapper.ts     # DB row <-> domain object mapping
  <name>.types.ts      # TypeScript types (optional)
  <name>.events.ts     # Domain events (optional)
  __tests__/           # Unit tests (bun:test)
```

**All modules (30):** agent-registry, agents, api-keys, audit-logs, auth, billing, collaboration, computer-use, context, credentials, execution, feature-flags, health, inbox, mcp, members, memory, notifications, orchestration, plugins, prompts, sessions, settings, skills, tasks, tools, usage, users, workflows, workspaces.

## Key Architecture Layers

```
Protocol Layer (WebSocket, REST, A2A, MCP, SSE)
       ↓
Unified Gateway — execute(op, params, context)
       ↓
Security Layer (Permission Pipeline, Sandbox, Tool Approvals)
       ↓
Domain Modules (skills, agents, tasks, sessions, memory, etc.)
       ↓
Infrastructure (DB, AI providers, Queue, Cache, Realtime)
```

## Adding a New Route

```ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const myRoute = createRoute({
  method: 'get',
  path: '/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Success', ...jsonRes },
    404: errRes('Not found'),
  },
});

export const myRoutes = new OpenAPIHono<AppEnv>();

myRoutes.openapi(myRoute, async (c) => {
  const { id } = c.req.valid('param');
  const workspaceId = c.get('workspaceId');
  // ...
  return c.json({ data: result });
});
```

## Adding a New Database Table

1. Define the table in `src/infra/db/schema/index.ts` using Drizzle's `pgTable`
2. Export it from the schema index
3. Run `bun run db:generate` to generate a migration
4. Run `bun run db:migrate` to apply it to dev DB
5. Run `bun run db:migrate:test` to apply it to test DB
6. If host port access to Postgres is broken but Docker is up, run `bun run db:migrate:docker`

## Running Checks

```bash
bun run infra:up           # start PostgreSQL + Redis via Docker
bun run test              # unit tests
bun run test:integration  # integration tests (needs DB + Redis)
bun run test:e2e          # e2e tests (needs DB + Redis)
bunx tsc --noEmit         # type check (must be 0 errors)
bun run infra:logs        # tail Docker service logs when debugging infra-backed tests
```

## Common Gotchas

- **Port 5434**: Docker maps PostgreSQL to port 5434 on the host, not 5432
- **Clerk in dev**: Leave `CLERK_SECRET_KEY` blank for insecure dev-mode JWT decode
- **Feature flags**: Stored in `workspace_settings` with `feature-flag:` key prefix, cached 60s
- **Event system**: 50+ topics across 14 categories — use `EventBus.publish()` not direct emitters
- **AI providers**: Always use the factory/runtime abstractions in `src/infra/ai/`, never import SDKs directly in modules
