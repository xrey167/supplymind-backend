-- Collab Intel fixes: add approval_chain_status enum

CREATE TYPE "public"."approval_chain_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TABLE "collab_approval_chains" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "collab_approval_chains"
  ALTER COLUMN "status" TYPE "public"."approval_chain_status"
  USING "status"::"public"."approval_chain_status";--> statement-breakpoint
ALTER TABLE "collab_approval_chains"
  ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."approval_chain_status";
