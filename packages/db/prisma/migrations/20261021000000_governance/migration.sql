-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN     "privacy" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "guardrail_policies" (
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
CREATE INDEX "guardrail_policies_botId_active_idx" ON "guardrail_policies"("botId", "active");

-- AddForeignKey
ALTER TABLE "guardrail_policies" ADD CONSTRAINT "guardrail_policies_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
