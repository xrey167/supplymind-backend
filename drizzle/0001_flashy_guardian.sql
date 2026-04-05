CREATE TYPE "public"."role" AS ENUM('system', 'admin', 'operator', 'agent', 'viewer');--> statement-breakpoint
ALTER TYPE "public"."skill_provider_type" ADD VALUE 'agent';--> statement-breakpoint
ALTER TYPE "public"."skill_provider_type" ADD VALUE 'tool';--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "role" SET DEFAULT 'admin'::"public"."role";--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";--> statement-breakpoint
CREATE INDEX "a2a_tasks_status_idx" ON "a2a_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sm_session_compacted_idx" ON "session_messages" USING btree ("session_id","is_compacted");--> statement-breakpoint
CREATE INDEX "task_deps_depends_on_idx" ON "task_dependencies" USING btree ("depends_on_task_id");--> statement-breakpoint
CREATE INDEX "tcl_task_id_idx" ON "tool_call_logs" USING btree ("task_id");