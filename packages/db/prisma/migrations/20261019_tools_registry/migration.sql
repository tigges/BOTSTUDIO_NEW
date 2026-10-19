CREATE TABLE IF NOT EXISTS "auth_profiles" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "secretEnc" TEXT,
  "secretHint" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_profiles_tenantId_name_key" ON "auth_profiles"("tenantId", "name");
DO $$ BEGIN
  ALTER TABLE "auth_profiles" ADD CONSTRAINT "auth_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "tools" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "parameters" JSONB NOT NULL DEFAULT '[]',
  "returns" JSONB NOT NULL DEFAULT '{}',
  "effect" TEXT NOT NULL DEFAULT 'read',
  "config" JSONB NOT NULL DEFAULT '{}',
  "authProfileId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tools_botId_name_key" ON "tools"("botId", "name");
CREATE INDEX IF NOT EXISTS "tools_tenantId_idx" ON "tools"("tenantId");
DO $$ BEGIN
  ALTER TABLE "tools" ADD CONSTRAINT "tools_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "tools" ADD CONSTRAINT "tools_authProfileId_fkey" FOREIGN KEY ("authProfileId") REFERENCES "auth_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "tool_runs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "conversationId" TEXT,
  "source" TEXT NOT NULL,
  "actorId" TEXT,
  "ok" BOOLEAN NOT NULL,
  "status" INTEGER,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "input" JSONB NOT NULL DEFAULT '{}',
  "output" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tool_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tool_runs_toolId_createdAt_idx" ON "tool_runs"("toolId", "createdAt");
CREATE INDEX IF NOT EXISTS "tool_runs_conversationId_idx" ON "tool_runs"("conversationId");
DO $$ BEGIN
  ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
