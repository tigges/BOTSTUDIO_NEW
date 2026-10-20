-- Idempotent: a database adopted by migrate.sh is db-pushed to the current
-- schema before this runs, so every statement must tolerate existing objects.

-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN IF NOT EXISTS "privacy" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE IF NOT EXISTS "guardrail_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardrail_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "guardrail_policies_botId_active_idx" ON "guardrail_policies"("botId", "active");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "guardrail_policies" ADD CONSTRAINT "guardrail_policies_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
