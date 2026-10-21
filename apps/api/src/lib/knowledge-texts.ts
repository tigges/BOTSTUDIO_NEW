import { prisma } from '@ybot/db'
import type { KnowledgeText } from '@ybot/shared'
import { BUSINESS_SOURCE_KIND } from './install-blueprint.js'

const MAX_DOCUMENTS = 300

/**
 * Every Knowledge document except Business details, as the text answers are built from.
 * A crawled page row keeps only its first 500 characters, so its indexed chunks are added.
 */
export async function knowledgeTexts(tenantId: string, botId: string): Promise<KnowledgeText[]> {
  const documents = await prisma.document.findMany({
    where: { tenantId, knowledgeSource: { botId, tenantId, kind: { not: BUSINESS_SOURCE_KIND } } },
    select: { id: true, title: true, content: true, knowledgeSource: { select: { name: true, kind: true } } },
    orderBy: { createdAt: 'asc' },
    take: MAX_DOCUMENTS,
  })
  if (documents.length === 0) return []
  const chunks = await prisma.$queryRawUnsafe<Array<{ documentId: string; content: string }>>(
    `SELECT "documentId", content FROM "document_chunks" WHERE "tenantId" = $1 AND "documentId" = ANY($2::text[])`,
    tenantId,
    documents.map((doc) => doc.id),
  ).catch(() => [])
  const byDocument = new Map<string, string[]>()
  for (const chunk of chunks) byDocument.set(chunk.documentId, [...(byDocument.get(chunk.documentId) ?? []), chunk.content])
  return documents.map((doc) => ({
    documentId: doc.id,
    title: doc.title,
    source: doc.knowledgeSource.name,
    sourceKind: doc.knowledgeSource.kind,
    text: [doc.content, ...(byDocument.get(doc.id) ?? [])].join('\n'),
  }))
}
