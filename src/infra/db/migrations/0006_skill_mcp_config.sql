ALTER TABLE "skill_definitions" ADD COLUMN IF NOT EXISTS "mcp_config" jsonb DEFAULT '{}';
