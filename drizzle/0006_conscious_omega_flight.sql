CREATE TABLE "plugin_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"installed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"filter" jsonb,
	"cursor" text,
	"batch_size" integer DEFAULT 100 NOT NULL,
	"schedule" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_installation_id_plugin_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."plugin_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_job_id_sync_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pi_workspace_plugin_idx" ON "plugin_installations" USING btree ("workspace_id","plugin_id");--> statement-breakpoint
CREATE INDEX "sj_workspace_entity_idx" ON "sync_jobs" USING btree ("workspace_id","entity_type");--> statement-breakpoint
CREATE INDEX "sj_installation_idx" ON "sync_jobs" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "sr_job_created_idx" ON "sync_records" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "sr_workspace_entity_created_idx" ON "sync_records" USING btree ("workspace_id","entity_type","created_at");