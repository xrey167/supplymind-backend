-- Webhook Ingestion + Alert Rules Engine

CREATE TYPE "public"."webhook_delivery_status" AS ENUM('received', 'processed', 'duplicate', 'failed');--> statement-breakpoint
CREATE TYPE "public"."alert_condition_operator" AS ENUM('eq', 'neq', 'gt', 'lt', 'contains', 'exists');--> statement-breakpoint

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
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "endpoint_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "delivery_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "headers" jsonb DEFAULT '{}' NOT NULL,
  "status" "webhook_delivery_status" DEFAULT 'received' NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "alert_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "event_topic" text NOT NULL,
  "conditions" jsonb DEFAULT '[]' NOT NULL,
  "notify_user_ids" jsonb DEFAULT '[]' NOT NULL,
  "message_template" text,
  "cooldown_seconds" integer DEFAULT 300 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "alert_rule_fires" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "event_topic" text NOT NULL,
  "event_data" jsonb,
  "fired_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fk"
  FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule_fires" ADD CONSTRAINT "alert_rule_fires_rule_id_fk"
  FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "webhook_endpoints_token_idx" ON "webhook_endpoints" USING btree ("token");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_workspace_idx" ON "webhook_endpoints" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_dedup_idx" ON "webhook_deliveries" USING btree ("endpoint_id", "delivery_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "alert_rules_workspace_idx" ON "alert_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "alert_rules_topic_idx" ON "alert_rules" USING btree ("event_topic");--> statement-breakpoint
CREATE INDEX "alert_rule_fires_rule_idx" ON "alert_rule_fires" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_rule_fires_workspace_fired_idx" ON "alert_rule_fires" USING btree ("workspace_id", "fired_at");
