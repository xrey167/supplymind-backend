ALTER TYPE "public"."workspace_role" ADD VALUE 'procurement_manager';--> statement-breakpoint
ALTER TYPE "public"."workspace_role" ADD VALUE 'logistics_coordinator';--> statement-breakpoint
ALTER TYPE "public"."workspace_role" ADD VALUE 'warehouse_operator';--> statement-breakpoint
ALTER TYPE "public"."workspace_role" ADD VALUE 'finance_approver';--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "attempt_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "plugin_source" text;