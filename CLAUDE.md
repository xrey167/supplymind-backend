# Backend

Hono + Bun API server on port 3001. Runtime is **Bun** — use Bun APIs, not Node.js.

## Commands

- `bun run dev` — dev server with watch (requires `.env.development`)
- `bun run test` — unit tests via **bun:test** (not vitest). Tests live in `__tests__/` dirs alongside source.
- `bun run test:integration` — integration tests (requires `.env.test` + running DB/Redis)
- `bun run test:e2e` — e2e tests (requires `.env.test`)
- `bun run db:setup` — migrate dev + test DBs and seed (run after fresh clone)
- `bun run db:generate` — generate Drizzle migration from schema changes
- `bun run db:migrate` — apply migrations to dev DB
- `bun run db:migrate:test` — apply migrations to test DB
- `bun run db:studio` — Drizzle Studio GUI
- `bun run seed` — seed dev database

## Source Layout (`src/`)

- `api/` — routes, middlewares, presenters
- `modules/` — domain modules; each has `.routes.ts`, `.service.ts`, `.repo.ts`, `.schemas.ts`, `.mapper.ts`
- `engine/` — agent execution engine
- `plugins/` — plugin system
- `sdk/` — internal SDK abstractions
- `config/` — environment config
- `core/` — shared kernel: errors, Result types, security, utilities
- `infra/` — external integrations: `db/` (Drizzle + Postgres), `ai/` (Anthropic/OpenAI/Google), `auth/` (Clerk), `queue/` (BullMQ + Redis), `email/` (Resend), `notifications/` (Novu), `observability/` (OpenTelemetry + Sentry), `webhooks/` (Svix)
- `contracts/` — shared Zod v4 schemas
- `events/` — domain event system (EventEmitter3)
- `jobs/` — BullMQ job definitions
- `app/` — bootstrap (`createApp` wires OpenAPIHono)

## Key Conventions

- Routes use `@hono/zod-openapi` — typed + auto-documented
- All validation via **Zod v4** (not v3 — API differs)
- Tests use **bun:test** (`describe`/`it`/`expect`) — place in `__tests__/` alongside source
- DB: Drizzle ORM + Postgres
- Auth: Clerk (webhook-driven user sync)
- Queue: BullMQ + Redis
