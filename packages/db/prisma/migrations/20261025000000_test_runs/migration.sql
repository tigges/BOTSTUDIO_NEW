-- Idempotent: a database adopted by migrate.sh is db-pushed to the current
-- schema before this runs, so every statement must tolerate existing objects.

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "testRunId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_testRunId_idx" ON "conversations"("testRunId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "test_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "seed" TEXT NOT NULL,
    "startedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB NOT NULL DEFAULT '{}',
    "checks" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "test_runs_botId_startedAt_idx" ON "test_runs"("botId", "startedAt");
