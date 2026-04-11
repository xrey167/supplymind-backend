CREATE TYPE "public"."plugin_event_type" AS ENUM('installed', 'enabled', 'disabled', 'config_updated', 'version_pinned', 'health_checked', 'uninstalled', 'rollback_initiated', 'rollback_completed');--> statement-breakpoint
CREATE TYPE "public"."plugin_kind" AS ENUM('remote_mcp', 'remote_a2a', 'webhook', 'local_sandboxed');--> statement-breakpoint
CREATE TYPE "public"."plugin_status" AS ENUM('installing', 'active', 'disabled', 'failed', 'uninstalling', 'uninstalled');--> statement-breakpoint
CREATE TABLE "plugin_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"kind" "plugin_kind" NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"publisher" text,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_type" "plugin_event_type" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
DROP TABLE IF EXISTS "plugin_installations" CASCADE;--> statement-breakpoint
CREATE TABLE "plugin_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_id" uuid NOT NULL,
	"status" "plugin_status" DEFAULT 'installing' NOT NULL,
	"pinned_version" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_binding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_binding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_by" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_events" ADD CONSTRAINT "plugin_events_installation_id_plugin_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."plugin_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_health_checks" ADD CONSTRAINT "plugin_health_checks_installation_id_plugin_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."plugin_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_plugin_id_plugin_catalog_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugin_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pc_name_version_idx" ON "plugin_catalog" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "pe_installation_created_idx" ON "plugin_events" USING btree ("installation_id","created_at");--> statement-breakpoint
CREATE INDEX "pe_workspace_created_idx" ON "plugin_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "phc_installation_checked_idx" ON "plugin_health_checks" USING btree ("installation_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pi_workspace_plugin_idx" ON "plugin_installations" USING btree ("workspace_id","plugin_id");--> statement-breakpoint
CREATE INDEX "pi_workspace_idx" ON "plugin_installations" USING btree ("workspace_id");
