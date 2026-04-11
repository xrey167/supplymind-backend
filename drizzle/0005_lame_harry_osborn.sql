CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
ALTER TYPE "public"."orchestration_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"session_id" uuid,
	"task_id" uuid,
	"model" text NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text,
	"token_hash" text NOT NULL,
	"type" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"invited_by" text,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_task_id_a2a_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."a2a_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ur_workspace_created_idx" ON "usage_records" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ur_agent_idx" ON "usage_records" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ur_task_idx" ON "usage_records" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "wt_workspace_id_idx" ON "workflow_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wi_token_hash_idx" ON "workspace_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "wi_workspace_email_idx" ON "workspace_invitations" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "wm_workspace_user_idx" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "wm_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orch_workspace_created_idx" ON "orchestrations" USING btree ("workspace_id","created_at");