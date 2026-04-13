-- Notification preferences: add quiet_hours column
ALTER TABLE "notification_preferences" ADD COLUMN "quiet_hours" jsonb;
