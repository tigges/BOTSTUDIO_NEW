
-- Idempotent: a database adopted by migrate.sh is db-pushed to the current
-- schema before this runs, so every statement must tolerate existing objects.

-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN IF NOT EXISTS "responseLength" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "bot_configs" ADD COLUMN IF NOT EXISTS "toolWaitEscalateSeconds" INTEGER;

-- FAQs become a managed Knowledge source, one document per question, so answers can find them.
INSERT INTO "knowledge_sources" ("id", "tenantId", "botId", "name", "kind", "config", "lastSyncAt", "createdAt", "updatedAt")
SELECT 'faqsrc_' || f."botId", f."tenantId", f."botId", 'FAQs', 'faq', jsonb_build_object('questions', count(*)), now(), now(), now()
  FROM "faqs" f
 WHERE NOT EXISTS (SELECT 1 FROM "knowledge_sources" ks WHERE ks."botId" = f."botId" AND ks."kind" = 'faq')
 GROUP BY f."botId", f."tenantId";

INSERT INTO "documents" ("id", "tenantId", "knowledgeSourceId", "title", "content", "status", "metadata", "createdAt", "updatedAt")
SELECT 'faqdoc_' || f."id", f."tenantId", ks."id", left(f."question", 180), 'Q: ' || f."question" || E'\nA: ' || f."answer", 'indexed', jsonb_build_object('faqId', f."id"), now(), now()
  FROM "faqs" f
  JOIN "knowledge_sources" ks ON ks."botId" = f."botId" AND ks."kind" = 'faq'
 WHERE NOT EXISTS (SELECT 1 FROM "documents" d WHERE d."knowledgeSourceId" = ks."id" AND d."metadata"->>'faqId' = f."id");
