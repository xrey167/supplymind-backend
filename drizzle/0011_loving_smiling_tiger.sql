ALTER TYPE "public"."proposal_status" ADD VALUE IF NOT EXISTS 'auto_applied' BEFORE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE IF NOT EXISTS 'rolled_back';--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "improvement_proposals" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."proposal_status";
EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "improvement_proposals" ALTER COLUMN "status" SET DATA TYPE "public"."proposal_status" USING "status"::"public"."proposal_status";
EXCEPTION WHEN others THEN null; END $$;
