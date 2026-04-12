# Agents Guide

Instructions for AI agents working on this codebase.

## Stack

- **Runtime**: Bun (not Node.js)
- **Framework**: Hono + `@hono/zod-openapi`
- **Language**: TypeScript (strict)
- **DB**: Drizzle ORM + PostgreSQL
- **Queue**: BullMQ + Redis
- **Auth**: Clerk (webhook-synced users)
- **Tests**: `bun:test` (not vitest/jest)

## Critical Rules

1. **Use `AppEnv`** — all `OpenAPIHono` instances must be `new OpenAPIHono<AppEnv>()` with the import from `src/core/types`. This types context variables (`workspaceId`, `callerId`, `callerRole`, `workspaceRole`, `userId`).

2. **Declare error responses** — route definitions must include all status codes the handler returns (400, 404, 500, etc.), not just the success code. Use the `errRes` helper pattern:
   ```ts
   const errRes = (desc: string) => ({ description: desc, ...jsonRes });
   ```

3. **Wrap list responses** — handlers returning arrays must wrap in `{ data: [...] }`, not return bare arrays.

4. **204 = no body** — use `c.body(null, 204)`, never `c.json({...}, 204)`.

5. **Zod v4** — not v3. API differs (e.g., `z.object({}).passthrough()` not `.catchall()`).

6. **Plugin status** — `plugin_installations.status` is an enum (`'active'`, `'disabled'`), not a boolean `enabled`.

7. **Tests alongside source** — place in `__tests__/` dirs next to the code, not in a top-level `tests/` dir (integration/e2e tests are the exception).

## Module Structure

Each domain module in `src/modules/` follows this layout:

```
modules/<name>/
  <name>.routes.ts     # OpenAPI route definitions + handlers
  <name>.service.ts    # Business logic
  <name>.repo.ts       # Database queries (Drizzle)
  <name>.schemas.ts    # Zod validation schemas
  <name>.mapper.ts     # DB row <-> domain object mapping
  __tests__/           # Unit tests
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

## Running Checks

```bash
bun run test              # unit tests
bun run test:integration  # integration tests (needs DB + Redis)
bunx tsc --noEmit         # type check (must be 0 errors)
```
