/**
 * Knowledge-sync BullMQ worker.
 *
 * Processes jobs from the "knowledge-sync" queue:
 *  - kind: 'website'  → crawl URLs with depth, chunk, embed, upsert into DocumentChunk
 *  - kind: 'file'     → parse uploaded file, chunk, embed, upsert
 *
 * Requires: PostgreSQL with pgvector extension + Redis for BullMQ.
 *
 * Schema note: add `DocumentChunk` model to Prisma schema if not already present.
 */

import { prisma } from '@ybot/db'
import { createEmbeddingAdapter } from '@ybot/llm'
import { withLlmScope } from '../lib/llm-ledger.js'

const embedder = createEmbeddingAdapter()

const CHUNK_SIZE = 400
const CHUNK_OVERLAP = 80

// ── Text splitter ─────────────────────────────────────────────────────────────
function splitIntoChunks(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []
  let i = 0
  while (i < words.length) {
    chunks.push(words.slice(i, i + size).join(' '))
    i += size - overlap
  }
  return chunks
}

// ── Website crawler ───────────────────────────────────────────────────────────
async function crawlWebsite(url: string, depth = 2): Promise<Array<{ url: string; text: string }>> {
  const visited = new Set<string>()
  const results: Array<{ url: string; text: string }> = []

  async function crawl(href: string, remainingDepth: number) {
    if (visited.has(href) || visited.size > 50) return
    visited.add(href)
    try {
      const resp = await fetch(href, { signal: AbortSignal.timeout(10_000) })
      if (!resp.ok) return
      const html = await resp.text()
      // Very simple text extraction — strip tags
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
      if (text.length > 100) results.push({ url: href, text })

      if (remainingDepth > 0) {
        const links = [...html.matchAll(/href="([^"#]+)"/g)].map((m) => m[1] ?? '')
        const base = new URL(href)
        const sameOrigin = links
          .filter((l) => l.startsWith('/') || l.startsWith(base.origin))
          .map((l) => (l.startsWith('/') ? `${base.origin}${l}` : l))
          .slice(0, 10)
        await Promise.all(sameOrigin.map((l) => crawl(l, remainingDepth - 1)))
      }
    } catch { /* ignore crawl errors */ }
  }

  await crawl(url, depth)
  return results
}

// ── Main ingestion function ───────────────────────────────────────────────────
export async function ingestKnowledgeSource(jobData: {
  sourceId: string
  tenantId: string
  botId: string
  kind: 'website' | 'file' | 'notion' | 'gdocs'
  config: Record<string, unknown>
}): Promise<void> {
  const { sourceId, tenantId, kind, config } = jobData

  const pages: Array<{ url?: string; text: string }> = []

  if (kind === 'website') {
    const baseUrl = String(config['url'] ?? '')
    const depth = Number(config['depth'] ?? 2)
    if (!baseUrl) return
    const crawled = await crawlWebsite(baseUrl, depth)
    pages.push(...crawled.map((p) => ({ url: p.url, text: p.text })))
  } else if (kind === 'file') {
    // For uploaded files, content should already be in config.text or fetched from MinIO
    const text = String(config['text'] ?? config['content'] ?? '')
    if (text) pages.push({ text })
  }

  if (pages.length === 0) return

  // Delete existing chunks for this source
  await prisma.$executeRawUnsafe(
    `DELETE FROM "document_chunks" dc USING "documents" d
     WHERE dc."documentId" = d.id AND d."knowledgeSourceId" = $1 AND d."tenantId" = $2`,
    sourceId,
    tenantId,
  )

  // Chunk + embed + upsert
  let pageCount = 0
  for (const page of pages) {
    // Create or update a Document record for this page
    const doc = await prisma.document.upsert({
      where: { id: `doc_${sourceId}_${pageCount}` },
      create: {
        id: `doc_${sourceId}_${pageCount}`,
        tenantId,
        knowledgeSourceId: sourceId,
        title: page.url ?? `Page ${pageCount + 1}`,
        content: page.text.slice(0, 500),
        status: 'indexed',
      },
      update: { content: page.text.slice(0, 500), status: 'indexed' },
    })

    const chunks = splitIntoChunks(page.text)
    for (const [idx, chunk] of chunks.entries()) {
      try {
        const embedResult = await embedder.embed({ texts: [chunk] })
        const embedding = embedResult.embeddings[0] ?? []
        await prisma.$executeRawUnsafe(
          `INSERT INTO "document_chunks" (id, "tenantId", "documentId", content, embedding, metadata, "createdAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4::vector, '{}', now())
           ON CONFLICT DO NOTHING`,
          tenantId,
          doc.id,
          chunk,
          JSON.stringify(embedding),
        )
      } catch (err) {
        console.error(`Embedding/upsert failed for chunk ${idx}:`, err)
      }
    }
    pageCount++
  }

  // Update source with sync time
  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: { lastSyncAt: new Date() },
  })
}

// ── BullMQ worker entrypoint ──────────────────────────────────────────────────
export async function startKnowledgeSyncWorker(): Promise<void> {
  try {
    const { Worker } = await import('bullmq')
    const ioredis = await import('ioredis')
    const IORedis = ioredis.default ?? ioredis as unknown as new (url: string, opts: object) => { get: (k: string) => Promise<string | null> }

    const connection = new (IORedis as unknown as new (url: string, opts: object) => object)(
      process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    )

    new Worker('knowledge-sync', async (job) => {
      await withLlmScope(
        { source: 'retrieval', tenantId: job.data.tenantId, botId: job.data.botId },
        () => ingestKnowledgeSource(job.data),
      )
    }, { connection, concurrency: 2 })

    console.log('[knowledge-sync worker] started')
  } catch (err) {
    console.warn('[knowledge-sync worker] not started (Redis unavailable):', err instanceof Error ? err.message : err)
  }
}
