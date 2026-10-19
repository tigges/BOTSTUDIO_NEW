CREATE TABLE IF NOT EXISTS "llm_calls" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "botId" TEXT,
  "conversationId" TEXT,
  "traceId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "environment" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "cachedTokens" INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "ttftMs" INTEGER,
  "costUsd" DOUBLE PRECISION,
  "ok" BOOLEAN NOT NULL DEFAULT true,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "llm_calls_tenantId_createdAt_idx" ON "llm_calls"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "llm_calls_conversationId_idx" ON "llm_calls"("conversationId");

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "outcome" TEXT;

UPDATE "conversations" SET "outcome" = 'escalated'
 WHERE "outcome" IS NULL AND ("status" = 'escalated' OR ("status" IN ('resolved', 'closed') AND "assignedTo" IS NOT NULL));
UPDATE "conversations" SET "outcome" = 'contained_resolved'
 WHERE "outcome" IS NULL AND "status" IN ('resolved', 'closed') AND "assignedTo" IS NULL;
