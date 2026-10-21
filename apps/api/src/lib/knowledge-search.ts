import { prisma } from '@ybot/db'
import { createEmbeddingAdapter } from '@ybot/llm'

const embedder = createEmbeddingAdapter()

/** One passage the bot may answer from, with the document it came from. */
export interface KnowledgeHit {
  content: string
  documentId: string
  title: string
  source: string
}

/** What a knowledge answer stores on its message, so the Inbox can show where it came from. */
export interface KnowledgeSourceRef {
  documentId: string
  title: string
  source: string
}

type Raw = (sql: string, ...params: unknown[]) => Promise<KnowledgeHit[]>

async function vectorHits(query: string, tenantId: string, botId: string, topK: number): Promise<KnowledgeHit[]> {
  try {
    const result = await embedder.embed({ texts: [query] })
    const vector = result.embeddings[0]
    if (!vector || vector.length === 0) return []
    return await (prisma.$queryRawUnsafe as Raw)(
      `SELECT dc.content, d.id AS "documentId", d.title, ks.name AS source
         FROM "document_chunks" dc
         JOIN "documents" d ON dc."documentId" = d.id
         JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
        WHERE dc."tenantId" = $2 AND ks."botId" = $3 AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> $1::vector
        LIMIT $4`,
      JSON.stringify(vector), tenantId, botId, topK,
    )
  } catch {
    return []
  }
}

/** Words for a Postgres OR query: letters and digits only, so the text can never break the query syntax. */
export function keywordQuery(query: string): string {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 12)
  return words.join(' | ')
}

/** Full-text match over whole documents, for when nothing is embedded or the embedder is down. */
async function keywordHits(query: string, tenantId: string, botId: string, topK: number): Promise<KnowledgeHit[]> {
  const terms = keywordQuery(query)
  if (!terms) return []
  try {
    return await (prisma.$queryRawUnsafe as Raw)(
      `SELECT d.content, d.id AS "documentId", d.title, ks.name AS source
         FROM "documents" d
         JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
        WHERE d."tenantId" = $2 AND ks."botId" = $3 AND d.status <> 'failed'
          AND to_tsvector('english', d.title || ' ' || d.content) @@ to_tsquery('english', $1)
        ORDER BY ts_rank(to_tsvector('english', d.title || ' ' || d.content), to_tsquery('english', $1)) DESC
        LIMIT $4`,
      terms, tenantId, botId, topK,
    )
  } catch {
    return []
  }
}

/** Closest passages for one bot: embeddings first, keywords when nothing is embedded. */
export async function searchKnowledgeHits(query: string, tenantId: string, botId: string, topK = 4): Promise<KnowledgeHit[]> {
  const hits = await vectorHits(query, tenantId, botId, topK)
  return hits.length ? hits : keywordHits(query, tenantId, botId, topK)
}

/** Closest knowledge chunks for one bot. Empty when nothing matches. */
export async function searchKnowledge(query: string, tenantId: string, botId: string, topK = 4): Promise<string[]> {
  return (await searchKnowledgeHits(query, tenantId, botId, topK)).map((hit) => hit.content)
}

/** Each document once, in the order the passages were found. */
export function sourcesOf(hits: KnowledgeHit[]): KnowledgeSourceRef[] {
  const seen = new Map<string, KnowledgeSourceRef>()
  for (const hit of hits) if (!seen.has(hit.documentId)) seen.set(hit.documentId, { documentId: hit.documentId, title: hit.title, source: hit.source })
  return [...seen.values()]
}

export function knowledgeBlock(chunks: string[]): string {
  if (chunks.length === 0) return ''
  return `\n\n--- KNOWLEDGE BASE ---\n${chunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join('\n\n')}\n--- END KNOWLEDGE BASE ---\n\nAnswer using only this context. If unknown, say so.`
}
