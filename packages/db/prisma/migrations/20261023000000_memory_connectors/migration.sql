-- Idempotent: a database adopted by migrate.sh is db-pushed to the current
-- schema before this runs, so every statement must tolerate existing objects.

-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN IF NOT EXISTS "memory" JSONB NOT NULL DEFAULT '{}';

-- AlterTable: the plaintext "apiKey" column stays this release. The API moves
-- each key into a sealed Auth Profile at boot and clears it.
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "authProfileId" TEXT;
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE IF NOT EXISTS "contact_memories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "botId" TEXT,
    "conversationId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_memories_tenantId_idx" ON "contact_memories"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "contact_memories_contactId_key_key" ON "contact_memories"("contactId", "key");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "contact_memories" ADD CONSTRAINT "contact_memories_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_authProfileId_fkey" FOREIGN KEY ("authProfileId") REFERENCES "auth_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
