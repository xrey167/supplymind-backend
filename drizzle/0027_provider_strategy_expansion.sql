-- Extend oauth_provider enum with 7 new IDE/AI provider values
DO $$ BEGIN
  ALTER TYPE "public"."oauth_provider" ADD VALUE IF NOT EXISTS 'codex';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."oauth_provider" ADD VALUE IF NOT EXISTS 'kiro';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."oauth_provider" ADD VALUE IF NOT EXISTS 'kilocode';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."oauth_provider" ADD VALUE IF NOT EXISTS 'cline';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."oauth_provider" ADD VALUE IF NOT EXISTS 'kimi-coding';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."oauth_provider" ADD VALUE IF NOT EXISTS 'cursor';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."oauth_provider" ADD VALUE IF NOT EXISTS 'antigravity';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Extend routing_strategy enum with 7 new strategy values
DO $$ BEGIN
  ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'random';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'strict-random';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'fill-first';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'least-used';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'p2c';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'auto';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'lkgp';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Add strict_random_deck column to workspace_routing_configs
ALTER TABLE "workspace_routing_configs"
  ADD COLUMN IF NOT EXISTS "strict_random_deck" jsonb;
