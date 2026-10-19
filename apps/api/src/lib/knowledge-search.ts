import { prisma } from '@ybot/db'
import { createEmbeddingAdapter } from '@ybot/llm'

const embedder = createEmbeddingAdapter()

/** Closest knowledge chunks for one bot. Empty when nothing is indexed or the embedder is down. */
export async function searchKnowledge(query: string, tenantId: string, botId: string, topK = 4): Promise<string[]> {
  try {
    const result = await embedder.embed({ texts: [query] })
    const vector = result.embeddings[0]
    if (!vector || vector.length === 0) return []
    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<Array<{ content: string }>>)(
      `SELECT dc.content
         FROM "document_chunks" dc
         JOIN "documents" d ON dc."documentId" = d.id
         JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
        WHERE dc."tenantId" = $2 AND ks."botId" = $3 AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> $1::vector
        LIMIT $4`,
      JSON.stringify(vector), tenantId, botId, topK,
    )
    return rows.map((row) => row.content)
  } catch {
    return []
  }
}

export function knowledgeBlock(chunks: string[]): string {
  if (chunks.length === 0) return ''
  return `\n\n--- KNOWLEDGE BASE ---\n${chunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join('\n\n')}\n--- END KNOWLEDGE BASE ---\n\nAnswer using only this context. If unknown, say so.`
}
