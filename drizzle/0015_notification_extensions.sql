-- Notification preferences: add quiet_hours column
ALTER TABLE "notification_preferences" ADD COLUMN "quiet_hours" jsonb;--> statement-breakpoint

-- Credential provider enum: add slack and telegram channels
ALTER TYPE "public"."credential_provider" ADD VALUE IF NOT EXISTS 'slack';--> statement-breakpoint
ALTER TYPE "public"."credential_provider" ADD VALUE IF NOT EXISTS 'telegram';
