ALTER TABLE "notifications" ALTER COLUMN "attempt_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "plugin_source" text;