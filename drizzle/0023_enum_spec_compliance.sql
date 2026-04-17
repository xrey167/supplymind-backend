-- Align agent_category and mission_artifact_kind enums with the spec
-- agent_category: remove coordinator/custom; add visual/ops/quick
-- mission_artifact_kind: replace text/json/file/image/code/report with
--   plan/summary/review/verification/diff/table/json/approval/question/metrics

-- ── 1. Rename old enums ──────────────────────────────────────────────────────
ALTER TYPE "public"."agent_category" RENAME TO "agent_category_old";
--> statement-breakpoint
ALTER TYPE "public"."mission_artifact_kind" RENAME TO "mission_artifact_kind_old";
--> statement-breakpoint

-- ── 2. Create corrected enums ────────────────────────────────────────────────
CREATE TYPE "public"."agent_category" AS ENUM(
  'executor', 'planner', 'researcher', 'reviewer', 'visual', 'ops', 'deep', 'quick'
);
--> statement-breakpoint
CREATE TYPE "public"."mission_artifact_kind" AS ENUM(
  'plan', 'summary', 'review', 'verification', 'diff', 'table',
  'json', 'approval', 'question', 'metrics'
);
--> statement-breakpoint

-- ── 3. Migrate existing rows (best-effort; dev DB only) ──────────────────────
ALTER TABLE "agent_profiles"
  ALTER COLUMN "category" TYPE "public"."agent_category"
  USING CASE category::text
    WHEN NULL          THEN NULL::agent_category
    WHEN 'executor'    THEN 'executor'::agent_category
    WHEN 'planner'     THEN 'planner'::agent_category
    WHEN 'researcher'  THEN 'researcher'::agent_category
    WHEN 'reviewer'    THEN 'reviewer'::agent_category
    WHEN 'deep'        THEN 'deep'::agent_category
    WHEN 'coordinator' THEN 'planner'::agent_category
    WHEN 'custom'      THEN 'executor'::agent_category
    ELSE 'executor'::agent_category
  END;
--> statement-breakpoint

ALTER TABLE "mission_workers"
  ALTER COLUMN "role" TYPE "public"."agent_category"
  USING CASE role::text
    WHEN NULL          THEN NULL::agent_category
    WHEN 'executor'    THEN 'executor'::agent_category
    WHEN 'planner'     THEN 'planner'::agent_category
    WHEN 'researcher'  THEN 'researcher'::agent_category
    WHEN 'reviewer'    THEN 'reviewer'::agent_category
    WHEN 'deep'        THEN 'deep'::agent_category
    WHEN 'coordinator' THEN 'planner'::agent_category
    WHEN 'custom'      THEN 'executor'::agent_category
    ELSE 'executor'::agent_category
  END;
--> statement-breakpoint

-- Artifact kind migration rationale:
-- 'plan', 'review', 'summary', 'json' → direct equivalents
-- 'text' → 'summary' (closest semantic match)
-- 'file', 'image', 'code', 'report' → 'json' (safe neutral default; data should be reviewed post-migration)
ALTER TABLE "mission_artifacts"
  ALTER COLUMN "kind" TYPE "public"."mission_artifact_kind"
  USING CASE kind::text
    WHEN NULL     THEN NULL::mission_artifact_kind
    WHEN 'json'   THEN 'json'::mission_artifact_kind
    WHEN 'text'   THEN 'summary'::mission_artifact_kind
    WHEN 'file'   THEN 'json'::mission_artifact_kind
    WHEN 'image'  THEN 'json'::mission_artifact_kind
    WHEN 'code'   THEN 'json'::mission_artifact_kind
    WHEN 'report' THEN 'summary'::mission_artifact_kind
    ELSE 'summary'::mission_artifact_kind
  END;
--> statement-breakpoint

-- ── 4. Drop old enums ────────────────────────────────────────────────────────
DROP TYPE "public"."agent_category_old";
--> statement-breakpoint
DROP TYPE "public"."mission_artifact_kind_old";

DO $$
BEGIN
  ALTER TYPE "public"."mission_status" ADD VALUE IF NOT EXISTS 'rejected';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- OAuth connections schema (kept in tracked migration because new drizzle files are ignored by repo rules)
CREATE TYPE "public"."oauth_connection_status" AS ENUM('active', 'error', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('claude', 'google', 'openai', 'github');
--> statement-breakpoint
CREATE TABLE "oauth_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider" "oauth_provider" NOT NULL,
  "email" text,
  "display_name" text,
  "encrypted_access_token" text NOT NULL,
  "access_token_iv" text NOT NULL,
  "access_token_tag" text NOT NULL,
  "encrypted_refresh_token" text,
  "refresh_token_iv" text,
  "refresh_token_tag" text,
  "expires_at" timestamp with time zone,
  "scope" text,
  "status" "oauth_connection_status" DEFAULT 'active' NOT NULL,
  "last_error" text,
  "last_refreshed_at" timestamp with time zone,
  "provider_data" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_connections"
  ADD CONSTRAINT "oauth_connections_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id")
  REFERENCES "public"."workspaces"("id")
  ON DELETE cascade
  ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "oc_workspace_provider_email_idx" ON "oauth_connections" USING btree ("workspace_id","provider","email");
--> statement-breakpoint
CREATE INDEX "oc_workspace_provider_idx" ON "oauth_connections" USING btree ("workspace_id","provider");
--> statement-breakpoint
CREATE INDEX "oc_expires_at_idx" ON "oauth_connections" USING btree ("expires_at");
--> statement-breakpoint
