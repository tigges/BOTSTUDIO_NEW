-- Idempotent: a database adopted by migrate.sh is db-pushed to the current
-- schema before this runs, so every statement must tolerate existing objects.

-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN IF NOT EXISTS "business" JSONB NOT NULL DEFAULT '{}';
