CREATE TYPE "public"."alert_condition_operator" AS ENUM('eq', 'neq', 'gt', 'lt', 'contains', 'exists');--> statement-breakpoint
CREATE TYPE "public"."approval_chain_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."board_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."collab_proposal_status" AS ENUM('open', 'closed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."mention_status" AS ENUM('pending', 'read', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."vote_type" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('received', 'processed', 'duplicate', 'failed');--> statement-breakpoint
CREATE TABLE "alert_rule_fires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_topic" text NOT NULL,
	"event_data" jsonb,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"event_topic" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_template" text,
	"cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"activity_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_approval_chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"status" "approval_chain_status" DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"approver_user_id" text NOT NULL,
	"status" "approval_step_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_board_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"visibility" "board_visibility" DEFAULT 'public' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"mentioned_by_user_id" text NOT NULL,
	"context_text" text NOT NULL,
	"status" "mention_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" text NOT NULL,
	"status" "collab_proposal_status" DEFAULT 'open' NOT NULL,
	"up_votes" integer DEFAULT 0 NOT NULL,
	"down_votes" integer DEFAULT 0 NOT NULL,
	"voting_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"vote_type" "vote_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"orchestration_id" text NOT NULL,
	"step_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"delivery_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token" text NOT NULL,
	"secret_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "quiet_hours" jsonb;--> statement-breakpoint
ALTER TABLE "alert_rule_fires" ADD CONSTRAINT "alert_rule_fires_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_activities" ADD CONSTRAINT "collab_activities_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_approval_chains" ADD CONSTRAINT "collab_approval_chains_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_approval_steps" ADD CONSTRAINT "collab_approval_steps_chain_id_collab_approval_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."collab_approval_chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_board_members" ADD CONSTRAINT "collab_board_members_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_mentions" ADD CONSTRAINT "collab_mentions_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_proposals" ADD CONSTRAINT "collab_proposals_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_votes" ADD CONSTRAINT "collab_votes_proposal_id_collab_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."collab_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rule_fires_rule_idx" ON "alert_rule_fires" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_rule_fires_workspace_fired_idx" ON "alert_rule_fires" USING btree ("workspace_id","fired_at");--> statement-breakpoint
CREATE INDEX "alert_rules_workspace_idx" ON "alert_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "alert_rules_topic_idx" ON "alert_rules" USING btree ("event_topic");--> statement-breakpoint
CREATE INDEX "ca_board_created_idx" ON "collab_activities" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "cac_board_idx" ON "collab_approval_chains" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "cas_chain_idx" ON "collab_approval_steps" USING btree ("chain_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "cbm_board_user_idx" ON "collab_board_members" USING btree ("board_id","user_id");--> statement-breakpoint
CREATE INDEX "cb_workspace_idx" ON "collab_boards" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "cm_board_mentioned_idx" ON "collab_mentions" USING btree ("board_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "cp_board_idx" ON "collab_proposals" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cv_proposal_user_idx" ON "collab_votes" USING btree ("proposal_id","user_id");--> statement-breakpoint
CREATE INDEX "gate_audit_orch_idx" ON "gate_audit_log" USING btree ("orchestration_id");--> statement-breakpoint
CREATE INDEX "gate_audit_workspace_created_idx" ON "gate_audit_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_dedup_idx" ON "webhook_deliveries" USING btree ("endpoint_id","delivery_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_workspace_idx" ON "webhook_endpoints" USING btree ("workspace_id");