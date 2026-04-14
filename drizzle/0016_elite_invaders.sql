CREATE TABLE "gate_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"orchestration_id" text NOT NULL,
	"step_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gate_audit_orch_idx" ON "gate_audit_log" USING btree ("orchestration_id");--> statement-breakpoint
CREATE INDEX "gate_audit_workspace_created_idx" ON "gate_audit_log" USING btree ("workspace_id","created_at");
