-- Mission template table, missionEvents log, budget tracking columns, missionRunId on usage_records

CREATE TYPE "public"."mission_template_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"mode" "mission_mode" NOT NULL,
	"goal_path" jsonb DEFAULT '{}'::jsonb,
	"budget_cents" integer,
	"status" "mission_template_status" DEFAULT 'draft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"parent_resource_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_runs" ADD COLUMN "mission_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD COLUMN "budget_cents" integer;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD COLUMN "spent_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD COLUMN "cost_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_workers" ADD COLUMN "task_id" text;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "mission_run_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "m_workspace_status_idx" ON "missions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "me_workspace_created_idx" ON "mission_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "me_resource_idx" ON "mission_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "ur_mission_run_idx" ON "usage_records" USING btree ("mission_run_id");
