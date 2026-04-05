CREATE TYPE "public"."a2a_task_status" AS ENUM('submitted', 'working', 'input_required', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."agent_mode" AS ENUM('raw', 'agent-sdk');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai', 'google');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('stdio', 'sse', 'streamable-http');--> statement-breakpoint
CREATE TYPE "public"."memory_source" AS ENUM('explicit', 'proposed', 'approved');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('domain', 'feedback', 'pattern', 'reference');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."orchestration_status" AS ENUM('submitted', 'running', 'paused', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('created', 'active', 'paused', 'closed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."skill_provider_type" AS ENUM('builtin', 'worker', 'plugin', 'mcp', 'inline');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tool_permission_mode" AS ENUM('auto', 'ask', 'strict');--> statement-breakpoint
CREATE TABLE "a2a_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" "a2a_task_status",
	"input" jsonb NOT NULL,
	"output" jsonb,
	"artifacts" jsonb,
	"history" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" "ai_provider",
	"mode" "agent_mode",
	"model" text NOT NULL,
	"system_prompt" text,
	"temperature" real DEFAULT 0.7,
	"max_tokens" integer DEFAULT 4096,
	"tool_ids" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"type" "memory_type" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"confidence" real DEFAULT 1,
	"source" "memory_source" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"embedding" vector(1536),
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"enabled" boolean DEFAULT true,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mcp_server_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"transport" "mcp_transport",
	"url" text,
	"command" text,
	"args" jsonb,
	"env" jsonb,
	"headers" jsonb,
	"enabled" boolean DEFAULT true,
	"tool_manifest_cache" jsonb,
	"cache_expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "memory_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" "memory_type" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"evidence" text,
	"session_id" uuid,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now(),
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "orchestrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid,
	"name" text,
	"definition" jsonb NOT NULL,
	"status" "orchestration_status" DEFAULT 'submitted' NOT NULL,
	"step_results" jsonb DEFAULT '{}'::jsonb,
	"current_step_id" text,
	"input" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "registered_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"agent_card" jsonb NOT NULL,
	"api_key_hash" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_discovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_call_id" text,
	"tool_calls" jsonb,
	"token_estimate" integer,
	"is_compacted" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"status" "session_status" DEFAULT 'created' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"token_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "skill_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"provider_type" "skill_provider_type",
	"priority" integer DEFAULT 0,
	"input_schema" jsonb DEFAULT '{}'::jsonb,
	"handler_config" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tool_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"skill_name" text NOT NULL,
	"status" "tool_call_status",
	"input" jsonb NOT NULL,
	"output" jsonb,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_a2a_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."a2a_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_a2a_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."a2a_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registered_agents_workspace_url_idx" ON "registered_agents" USING btree ("workspace_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_settings_workspace_key_idx" ON "workspace_settings" USING btree ("workspace_id","key");