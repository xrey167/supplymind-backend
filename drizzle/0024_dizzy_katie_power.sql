CREATE TYPE "public"."oauth_connection_status" AS ENUM('active', 'error', 'expired');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('claude', 'google', 'openai', 'github');--> statement-breakpoint
ALTER TYPE "public"."mission_status" ADD VALUE 'rejected';--> statement-breakpoint
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
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oc_workspace_provider_email_idx" ON "oauth_connections" USING btree ("workspace_id","provider","email");--> statement-breakpoint
CREATE INDEX "oc_workspace_provider_idx" ON "oauth_connections" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "oc_expires_at_idx" ON "oauth_connections" USING btree ("expires_at");