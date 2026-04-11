DO $$ BEGIN
  CREATE TYPE "public"."plugin_event_type" AS ENUM('installed', 'enabled', 'disabled', 'config_updated', 'version_pinned', 'health_checked', 'uninstalled', 'rollback_initiated', 'rollback_completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."plugin_kind" AS ENUM('remote_mcp', 'remote_a2a', 'webhook', 'local_sandboxed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."plugin_status" AS ENUM('installing', 'active', 'disabled', 'failed', 'uninstalling', 'uninstalled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adaptation_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_cycle_at" timestamp with time zone,
	"cycle_count" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_knowledge_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_graph" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vocabulary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "improvement_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_id" text,
	"proposal_type" text NOT NULL,
	"change_type" text NOT NULL,
	"description" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rollback_data" jsonb,
	"auto_applied_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_id" text,
	"observation_type" text NOT NULL,
	"signal_strength" real DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_topic" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_catalog" (
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
CREATE TABLE IF NOT EXISTS "plugin_events" (
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
CREATE TABLE IF NOT EXISTS "plugin_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_performance_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"plugin_id" text,
	"invocation_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"avg_latency_ms" real,
	"p95_latency_ms" real,
	"last_failure_reason" text,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "pi_workspace_plugin_idx";
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plugin_installations'
      AND column_name = 'plugin_id'
      AND data_type = 'text'
  ) THEN
    -- Delete rows with non-UUID plugin_id values before casting
    DELETE FROM "plugin_installations"
    WHERE "plugin_id" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    ALTER TABLE "plugin_installations" ALTER COLUMN "plugin_id" SET DATA TYPE uuid USING "plugin_id"::uuid;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" ALTER COLUMN "config" SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" ADD COLUMN "status" "plugin_status" DEFAULT 'installing' NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" ADD COLUMN "pinned_version" text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" ADD COLUMN "secret_binding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" ADD COLUMN "policy_binding" jsonb DEFAULT '{}'::jsonb NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" ADD COLUMN "installed_at" timestamp with time zone DEFAULT now() NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "adaptation_agents" ADD CONSTRAINT "adaptation_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "domain_knowledge_graphs" ADD CONSTRAINT "domain_knowledge_graphs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "improvement_proposals" ADD CONSTRAINT "improvement_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "learning_observations" ADD CONSTRAINT "learning_observations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_events" ADD CONSTRAINT "plugin_events_installation_id_plugin_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."plugin_installations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_health_checks" ADD CONSTRAINT "plugin_health_checks_installation_id_plugin_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."plugin_installations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "skill_performance_metrics" ADD CONSTRAINT "skill_performance_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aa_workspace_plugin_idx" ON "adaptation_agents" USING btree ("workspace_id","plugin_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dkg_plugin_workspace_idx" ON "domain_knowledge_graphs" USING btree ("plugin_id","workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dkg_workspace_idx" ON "domain_knowledge_graphs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ip_workspace_status_idx" ON "improvement_proposals" USING btree ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ip_workspace_created_idx" ON "improvement_proposals" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lo_workspace_created_idx" ON "learning_observations" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lo_workspace_type_idx" ON "learning_observations" USING btree ("workspace_id","observation_type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pc_name_version_idx" ON "plugin_catalog" USING btree ("name","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pe_installation_created_idx" ON "plugin_events" USING btree ("installation_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pe_workspace_created_idx" ON "plugin_events" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phc_installation_checked_idx" ON "plugin_health_checks" USING btree ("installation_id","checked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spm_workspace_skill_window_idx" ON "skill_performance_metrics" USING btree ("workspace_id","skill_id","window_start");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_plugin_id_plugin_catalog_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugin_catalog"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pi_workspace_idx" ON "plugin_installations" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pi_workspace_plugin_idx" ON "plugin_installations" USING btree ("workspace_id","plugin_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" DROP COLUMN "enabled";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" DROP COLUMN "installed_by";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "plugin_installations" DROP COLUMN "created_at";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
