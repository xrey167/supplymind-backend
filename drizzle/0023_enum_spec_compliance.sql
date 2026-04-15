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

ALTER TABLE "mission_artifacts"
  ALTER COLUMN "kind" TYPE "public"."mission_artifact_kind"
  USING CASE kind::text
    WHEN 'json'   THEN 'json'::mission_artifact_kind
    WHEN 'text'   THEN 'summary'::mission_artifact_kind
    WHEN 'file'   THEN 'table'::mission_artifact_kind
    WHEN 'image'  THEN 'metrics'::mission_artifact_kind
    WHEN 'code'   THEN 'diff'::mission_artifact_kind
    WHEN 'report' THEN 'summary'::mission_artifact_kind
    ELSE 'summary'::mission_artifact_kind
  END;
--> statement-breakpoint

-- ── 4. Drop old enums ────────────────────────────────────────────────────────
DROP TYPE "public"."agent_category_old";
--> statement-breakpoint
DROP TYPE "public"."mission_artifact_kind_old";
