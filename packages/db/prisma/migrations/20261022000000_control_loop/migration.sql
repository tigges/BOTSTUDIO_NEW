-- Idempotent: a database adopted by migrate.sh is db-pushed to the current
-- schema before this runs, so every statement must tolerate existing objects.

-- AlterTable
ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "liveReleaseId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "eval_suites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gate" BOOLEAN NOT NULL DEFAULT true,
    "scenarios" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_suites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "eval_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '[]',
    "costUsd" DOUBLE PRECISION,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "target" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bot_releases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "chapters" JSONB NOT NULL,
    "entry" TEXT,
    "note" TEXT,
    "evalRunIds" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eval_suites_botId_idx" ON "eval_suites"("botId");
CREATE INDEX IF NOT EXISTS "eval_runs_suiteId_createdAt_idx" ON "eval_runs"("suiteId", "createdAt");
CREATE INDEX IF NOT EXISTS "bot_releases_botId_environmentId_idx" ON "bot_releases"("botId", "environmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "bot_releases_botId_environmentId_number_key" ON "bot_releases"("botId", "environmentId", "number");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "eval_suites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_releases" ADD CONSTRAINT "bot_releases_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A release is what guests heard. It is never edited; rollback moves the
-- environment's pointer instead. Deleting the bot still removes its releases.
CREATE OR REPLACE FUNCTION bot_releases_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Releases cannot be changed. Publish a new release or roll back instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bot_releases_no_update ON "bot_releases";
CREATE TRIGGER bot_releases_no_update BEFORE UPDATE ON "bot_releases"
  FOR EACH ROW EXECUTE FUNCTION bot_releases_immutable();
