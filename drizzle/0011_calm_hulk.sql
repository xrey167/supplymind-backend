-- Collaborative Intelligence Module

CREATE TYPE "public"."board_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."mention_status" AS ENUM('pending', 'read', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."collab_proposal_status" AS ENUM('open', 'closed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vote_type" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint

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
CREATE TABLE "collab_board_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "collab_approval_chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
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
CREATE TABLE "collab_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"activity_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "collab_board_members" ADD CONSTRAINT "collab_board_members_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_mentions" ADD CONSTRAINT "collab_mentions_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_proposals" ADD CONSTRAINT "collab_proposals_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_votes" ADD CONSTRAINT "collab_votes_proposal_id_collab_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."collab_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_approval_chains" ADD CONSTRAINT "collab_approval_chains_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_approval_steps" ADD CONSTRAINT "collab_approval_steps_chain_id_collab_approval_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."collab_approval_chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_activities" ADD CONSTRAINT "collab_activities_board_id_collab_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."collab_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "cb_workspace_idx" ON "collab_boards" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cbm_board_user_idx" ON "collab_board_members" USING btree ("board_id","user_id");--> statement-breakpoint
CREATE INDEX "cm_board_mentioned_idx" ON "collab_mentions" USING btree ("board_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "cp_board_idx" ON "collab_proposals" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cv_proposal_user_idx" ON "collab_votes" USING btree ("proposal_id","user_id");--> statement-breakpoint
CREATE INDEX "cac_board_idx" ON "collab_approval_chains" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "cas_chain_idx" ON "collab_approval_steps" USING btree ("chain_id","step_index");--> statement-breakpoint
CREATE INDEX "ca_board_created_idx" ON "collab_activities" USING btree ("board_id","created_at");