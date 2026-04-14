CREATE TYPE "public"."agent_category" AS ENUM('executor', 'planner', 'researcher', 'reviewer', 'deep', 'coordinator', 'custom');--> statement-breakpoint
CREATE TYPE "public"."mission_artifact_kind" AS ENUM('text', 'json', 'file', 'image', 'code', 'report');--> statement-breakpoint
CREATE TYPE "public"."mission_mode" AS ENUM('assist', 'interview', 'advisor', 'team', 'autopilot', 'discipline');--> statement-breakpoint
CREATE TYPE "public"."mission_status" AS ENUM('pending', 'running', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."mission_worker_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."mission_permission_mode" AS ENUM('auto', 'ask', 'strict');--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "agent_category" NOT NULL,
	"provider" text,
	"model" text,
	"system_prompt" text,
	"temperature" integer,
	"max_tokens" integer,
	"permission_mode" "mission_permission_mode" DEFAULT 'ask',
	"is_default" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_run_id" uuid NOT NULL,
	"worker_id" uuid,
	"kind" "mission_artifact_kind" NOT NULL,
	"title" text,
	"content" text,
	"content_json" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" "mission_mode" NOT NULL,
	"status" "mission_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"discipline_max_retries" integer DEFAULT 3,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mission_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_run_id" uuid NOT NULL,
	"role" "agent_category" NOT NULL,
	"phase" text,
	"status" "mission_worker_status" DEFAULT 'pending' NOT NULL,
	"agent_profile_id" uuid,
	"output" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "attempt_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "mission_artifacts" ADD CONSTRAINT "mission_artifacts_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_artifacts" ADD CONSTRAINT "mission_artifacts_worker_id_mission_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."mission_workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_workers" ADD CONSTRAINT "mission_workers_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_workspace_category_idx" ON "agent_profiles" USING btree ("workspace_id","category");--> statement-breakpoint
CREATE INDEX "ap_workspace_default_idx" ON "agent_profiles" USING btree ("workspace_id","is_default");--> statement-breakpoint
CREATE INDEX "ma_mission_run_idx" ON "mission_artifacts" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "ma_mission_run_created_idx" ON "mission_artifacts" USING btree ("mission_run_id","created_at");--> statement-breakpoint
CREATE INDEX "mr_workspace_status_idx" ON "mission_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "mr_workspace_created_idx" ON "mission_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "mw_mission_run_idx" ON "mission_workers" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "mw_mission_status_idx" ON "mission_workers" USING btree ("mission_run_id","status");