CREATE TYPE "public"."routing_strategy" AS ENUM('priority', 'round-robin', 'weighted', 'cost-optimized');--> statement-breakpoint
CREATE TABLE "workspace_routing_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy" "routing_strategy" DEFAULT 'priority' NOT NULL,
	"providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"round_robin_counter" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_routing_configs_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE INDEX "workspace_routing_configs_ws_idx" ON "workspace_routing_configs" USING btree ("workspace_id");