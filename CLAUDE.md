# Backend

Hono + Bun API server on port 3001. Runtime is **Bun** — use Bun APIs, not Node.js.

## Commands

- `bun run dev` — dev server with watch (requires `.env.development`)
- `bun run build` — build to `dist/`
- `bun run start` — start built server
- `bun run test` — unit tests via **bun:test** (not vitest). Tests live in `__tests__/` dirs alongside source.
- `bun run test:integration` — integration tests (requires `.env.test` + running DB/Redis)
- `bun run test:e2e` — e2e tests (requires `.env.test`)
- `bun run db:setup` — migrate dev + test DBs and seed (run after fresh clone)
- `bun run db:generate` — generate Drizzle migration from schema changes
- `bun run db:migrate` — apply migrations to dev DB
- `bun run db:migrate:test` — apply migrations to test DB
- `bun run db:push` — push schema directly (dev only, no migration file)
- `bun run db:studio` — Drizzle Studio GUI
- `bun run seed` — seed dev database
- `bun run create-admin` — create an admin user
- `bun run infra:up` — start Docker containers (PostgreSQL + Redis)
- `bun run infra:down` — stop Docker containers
- `bun run infra:logs` — tail Docker container logs

## Source Layout (`src/`)

- `api/` — routes, middlewares, presenters (HTTP layer)
- `app/` — bootstrap (`createApp` wires OpenAPIHono + subsystems)
- `config/` — environment config (Zod-validated)
- `contracts/` — shared Zod v4 schemas (api, events, notifications, permissions)
- `core/` — shared kernel: `ai/`, `config/`, `errors/`, `gateway/`, `hooks/`, `permissions/`, `result/`, `security/`, `telemetry/`, `tenant/`, `tools/`, `types/`, `utils/`
- `engine/` — agent execution engine (coordinator, runtime loop, tool dispatch)
- `events/` — domain event system (EventEmitter3, Redis pub/sub bridge, 50+ topics)
- `infra/` — external integrations: `a2a/`, `ai/` (Anthropic/OpenAI/Google), `auth/` (Clerk), `cache/`, `db/` (Drizzle + Postgres + pgvector), `mcp/`, `notifications/` (Novu), `observability/` (OpenTelemetry + Sentry), `queue/` (BullMQ + Redis), `realtime/` (WebSocket + SSE), `redis/`, `state/`, `storage/`, `webhooks/`
- `jobs/` — BullMQ job definitions (agents, billing, cleanup, notifications, orchestrations, sync)
- `modules/` — 30 domain modules; each has `.routes.ts`, `.service.ts`, `.repo.ts`, `.schemas.ts`, `.mapper.ts`
- `plugins/` — plugin system + domain plugin implementations (erp-bc)
- `sdk/` — internal SDK abstractions

## Key Conventions

- Routes use `@hono/zod-openapi` — typed + auto-documented
- `AppEnv` type (`src/core/types/env.ts`) declares Hono context variables — all route files use `OpenAPIHono<AppEnv>()`
- Route definitions include error responses (400/404/500) — handlers return `{ data: ... }` for list endpoints
- Plugin installations use `status` enum (active/disabled), not boolean `enabled`
- All validation via **Zod v4** (not v3 — API differs)
- Tests use **bun:test** (`describe`/`it`/`expect`) — place in `__tests__/` alongside source
- DB: Drizzle ORM + Postgres (38 tables, pgvector for embeddings)
- Auth: Clerk (webhook-driven user sync) + API key auth (`a2a_k_` prefix)
- Queue: BullMQ + Redis (7 queues)
- AI: Multi-provider (Anthropic, OpenAI, Google) with fallback chain
- All protocol surfaces converge to a single `execute(op, params, context)` gateway function
- No domain-specific code in `src/core/`, `src/infra/`, or `src/events/`
