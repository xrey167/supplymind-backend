import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CLERK_SECRET_KEY: z.string(),
  STRIPE_SECRET_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NOVU_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('supplymind-backend'),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  // AI routing
  AI_DEFAULT_PROVIDER: z.enum(['anthropic', 'openai', 'google']).default('anthropic'),
  AI_FALLBACK_ENABLED: z
    .string()
    .default('true')
    .transform(v => v !== 'false'),
  MODEL_OVERRIDE_FAST: z.string().optional(),
  MODEL_OVERRIDE_BALANCED: z.string().optional(),
  MODEL_OVERRIDE_POWERFUL: z.string().optional(),
  INTENT_GATE_ENABLED: z
    .string()
    .default('true')
    .transform(v => v !== 'false'),
  // Compaction
  COMPACTION_MAX_MESSAGES: z.coerce.number().default(100),
  COMPACTION_TOKEN_BUDGET: z.coerce.number().default(150_000),
  // SSE resumption
  SSE_SEQUENCE_ENABLED: z
    .string()
    .default('true')
    .transform(v => v !== 'false'),
  // Memory
  MEMORY_AUTO_EXTRACT: z
    .string()
    .default('false')
    .transform(v => v === 'true'),
  // Idempotency
  AI_IDEMPOTENCY_ENABLED: z
    .string()
    .default('true')
    .transform(v => v !== 'false'),
  // Credentials encryption (used for both static API keys and OAuth tokens)
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
  // OAuth provider client IDs (public — PKCE provides security; no secrets for PKCE providers)
  CLAUDE_OAUTH_CLIENT_ID: z.string().optional(),
  CLAUDE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),   // Google requires client_secret
  OPENAI_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
