CREATE TABLE IF NOT EXISTS "start_templates" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clusterId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "sourceHost" TEXT,
  "spec" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "start_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "start_templates_tenantId_idx" ON "start_templates"("tenantId");

ALTER TABLE "start_templates" DROP CONSTRAINT IF EXISTS "start_templates_tenantId_fkey";
ALTER TABLE "start_templates" ADD CONSTRAINT "start_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
