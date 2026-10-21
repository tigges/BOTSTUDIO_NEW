/**
 * Search & Test for the Knowledge screen: run one question through semantic,
 * keyword or hybrid retrieval, time each engine, and say why each passage came
 * back. Chats keep using `searchKnowledgeHits` (semantic, keyword when nothing
 * is embedded); this module never changes what the bot answers from.
 */

import { prisma } from '@botstudio/db'
import { createEmbeddingAdapter } from '@botstudio/llm'
import { BUSINESS_KIND, keywordQuery, preferBusiness } from './knowledge-search.js'

export const SEARCH_MODES = ['hybrid', 'semantic', 'keyword'] as const
export type SearchMode = typeof SEARCH_MODES[number]

export interface EngineHit {
  /** Null when a document has no passages and matched as a whole. */
  chunkId: string | null
  content: string
  documentId: string
  title: string
  source: string
  sourceKind: string
  /** Cosine distance for semantic hits, ts_rank for keyword hits. */
  raw: number
}

export type EngineState = { state: 'ok'; ms: number; hits: number } | { state: 'skipped' } | { state: 'unavailable'; ms: number; reason: string }

export interface SearchTestResult {
  rank: number
  chunkId: string | null
  content: string
  documentId: string
  title: string
  source: string
  sourceKind: string
  why: {
    semantic: { rank: number; similarity: number } | null
    keyword: { rank: number; score: number } | null
    matchedTerms: string[]
    /** Reciprocal-rank score in hybrid mode. */
    fused: number | null
    /** Business details outrank other sources and were moved up. */
    businessFirst: boolean
  }
}

export interface SearchTestReport {
  query: string
  mode: SearchMode
  topK: number
  engines: { embed: EngineState; semantic: EngineState; keyword: EngineState }
  totalMs: number
  results: SearchTestResult[]
}

const RRF_K = 60

export function hitKey(hit: Pick<EngineHit, 'chunkId' | 'documentId'>): string {
  return hit.chunkId ?? `doc:${hit.documentId}`
}

/** Words Postgres' English search ignores, so they are not reported as matches either. */
const STOP_WORDS = new Set([
  'the', 'and', 'are', 'you', 'your', 'our', 'how', 'what', 'when', 'where', 'who', 'why', 'which', 'for', 'with',
  'can', 'does', 'did', 'this', 'that', 'these', 'those', 'from', 'have', 'has', 'had', 'was', 'were', 'will', 'would',
  'there', 'their', 'they', 'them', 'then', 'than', 'its', 'into', 'about', 'any', 'all', 'but', 'not', 'out', 'too',
  'very', 'just', 'some', 'such', 'only', 'own', 'same', 'more', 'most', 'other', 'should', 'could', 'been', 'being',
  'here', 'over', 'under', 'again', 'once', 'each', 'few', 'both', 'between', 'through', 'during', 'before', 'after',
  'above', 'below', 'off', 'yours', 'him', 'her', 'his', 'hers', 'she', 'myself', 'yourself', 'whom', 'while', 'because',
])

/** Query words found in the passage at the start of a word, lower case, stop words left out. */
export function matchedTerms(query: string, content: string): string[] {
  const terms = keywordQuery(query).split(' | ').filter((term) => term && !STOP_WORDS.has(term))
  return terms.filter((term) => new RegExp(`(?<![\\p{L}\\p{N}])${term}`, 'iu').test(content))
}

/** Reciprocal rank fusion: each engine adds 1 / (60 + rank). Ties keep semantic order. */
export function fuseRankings(semantic: EngineHit[], keyword: EngineHit[]): Array<{ hit: EngineHit; fused: number }> {
  const rows = new Map<string, { hit: EngineHit; fused: number; first: number }>()
  const add = (hits: EngineHit[], offset: number) => hits.forEach((hit, index) => {
    const key = hitKey(hit)
    const row = rows.get(key) ?? { hit, fused: 0, first: offset + index }
    row.fused += 1 / (RRF_K + index + 1)
    rows.set(key, row)
  })
  add(semantic, 0)
  add(keyword, semantic.length)
  return [...rows.values()].sort((a, b) => b.fused - a.fused || a.first - b.first).map(({ hit, fused }) => ({ hit, fused }))
}

export function explain(query: string, mode: SearchMode, semantic: EngineHit[], keyword: EngineHit[], topK: number): SearchTestResult[] {
  const semanticRank = new Map(semantic.map((hit, i) => [hitKey(hit), { rank: i + 1, similarity: Math.max(0, 1 - hit.raw) }]))
  const keywordRank = new Map(keyword.map((hit, i) => [hitKey(hit), { rank: i + 1, score: hit.raw }]))
  const ordered = mode === 'hybrid'
    ? fuseRankings(semantic, keyword)
    : (mode === 'semantic' ? semantic : keyword).map((hit) => ({ hit, fused: null as number | null }))
  const byKey = new Map(ordered.map((row) => [hitKey(row.hit), row]))
  const picked = preferBusiness(ordered.map((row) => row.hit), topK)
  return picked.map((hit, index) => {
    const key = hitKey(hit)
    const before = ordered.findIndex((row) => hitKey(row.hit) === key)
    return {
      rank: index + 1,
      chunkId: hit.chunkId,
      content: hit.content,
      documentId: hit.documentId,
      title: hit.title,
      source: hit.source,
      sourceKind: hit.sourceKind,
      why: {
        semantic: semanticRank.get(key) ?? null,
        keyword: keywordRank.get(key) ?? null,
        matchedTerms: matchedTerms(query, hit.content),
        fused: byKey.get(key)?.fused ?? null,
        businessFirst: hit.sourceKind === BUSINESS_KIND && before > index,
      },
    }
  })
}

type Raw = (sql: string, ...params: unknown[]) => Promise<EngineHit[]>

const embedder = createEmbeddingAdapter()

async function semanticSearch(query: string, tenantId: string, botId: string, pool: number): Promise<{ embed: EngineState; semantic: EngineState; hits: EngineHit[] }> {
  const t0 = Date.now()
  let vector: number[] | undefined
  try {
    vector = (await embedder.embed({ texts: [query] })).embeddings[0]
  } catch (err) {
    const ms = Date.now() - t0
    const reason = `The embedding model did not answer (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}). Semantic search needs one; ask whoever runs this BotStudio to connect an embedding model.`
    return { embed: { state: 'unavailable', ms, reason }, semantic: { state: 'unavailable', ms: 0, reason: 'Needs the query embedding.' }, hits: [] }
  }
  const embedMs = Date.now() - t0
  if (!vector?.length) {
    const reason = 'The embedding model returned no vector for this question.'
    return { embed: { state: 'unavailable', ms: embedMs, reason }, semantic: { state: 'unavailable', ms: 0, reason: 'Needs the query embedding.' }, hits: [] }
  }
  const t1 = Date.now()
  try {
    const hits = await (prisma.$queryRawUnsafe as Raw)(
      `SELECT dc.id AS "chunkId", dc.content, d.id AS "documentId", d.title, ks.name AS source, ks.kind AS "sourceKind",
              (dc.embedding <=> $1::vector)::float8 AS raw
         FROM "document_chunks" dc
         JOIN "documents" d ON dc."documentId" = d.id
         JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
        WHERE dc."tenantId" = $2 AND ks."botId" = $3 AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> $1::vector
        LIMIT $4`,
      JSON.stringify(vector), tenantId, botId, pool,
    )
    return { embed: { state: 'ok', ms: embedMs, hits: 1 }, semantic: { state: 'ok', ms: Date.now() - t1, hits: hits.length }, hits }
  } catch (err) {
    const reason = `Vector search failed (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}). The embedding size may not match the stored passages; sync the sources again.`
    return { embed: { state: 'ok', ms: embedMs, hits: 1 }, semantic: { state: 'unavailable', ms: Date.now() - t1, reason }, hits: [] }
  }
}

/** Passages by full-text rank; documents without passages match as a whole. */
async function keywordSearch(query: string, tenantId: string, botId: string, pool: number): Promise<{ keyword: EngineState; hits: EngineHit[] }> {
  const terms = keywordQuery(query)
  if (!terms) return { keyword: { state: 'unavailable', ms: 0, reason: 'The question has no words of three letters or more to match.' }, hits: [] }
  const t0 = Date.now()
  try {
    const hits = await (prisma.$queryRawUnsafe as Raw)(
      `SELECT * FROM (
         SELECT dc.id AS "chunkId", dc.content, d.id AS "documentId", d.title, ks.name AS source, ks.kind AS "sourceKind",
                ts_rank(to_tsvector('english', dc.content), to_tsquery('english', $1))::float8 AS raw
           FROM "document_chunks" dc
           JOIN "documents" d ON dc."documentId" = d.id
           JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
          WHERE dc."tenantId" = $2 AND ks."botId" = $3 AND d.status <> 'failed'
            AND to_tsvector('english', dc.content) @@ to_tsquery('english', $1)
         UNION ALL
         SELECT NULL AS "chunkId", d.content, d.id AS "documentId", d.title, ks.name AS source, ks.kind AS "sourceKind",
                ts_rank(to_tsvector('english', d.title || ' ' || d.content), to_tsquery('english', $1))::float8 AS raw
           FROM "documents" d
           JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
          WHERE d."tenantId" = $2 AND ks."botId" = $3 AND d.status <> 'failed'
            AND NOT EXISTS (SELECT 1 FROM "document_chunks" c WHERE c."documentId" = d.id)
            AND to_tsvector('english', d.title || ' ' || d.content) @@ to_tsquery('english', $1)
       ) hits
       ORDER BY raw DESC
       LIMIT $4`,
      terms, tenantId, botId, pool,
    )
    return { keyword: { state: 'ok', ms: Date.now() - t0, hits: hits.length }, hits }
  } catch (err) {
    return { keyword: { state: 'unavailable', ms: Date.now() - t0, reason: `Keyword search failed (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}).` }, hits: [] }
  }
}

export async function runSearchTest(input: { query: string; mode: SearchMode; topK: number; tenantId: string; botId: string }): Promise<SearchTestReport> {
  const started = Date.now()
  const pool = Math.max(input.topK * 3, 10)
  const wantSemantic = input.mode !== 'keyword'
  const wantKeyword = input.mode !== 'semantic'
  const [semantic, keyword] = await Promise.all([
    wantSemantic ? semanticSearch(input.query, input.tenantId, input.botId, pool) : null,
    wantKeyword ? keywordSearch(input.query, input.tenantId, input.botId, pool) : null,
  ])
  return {
    query: input.query,
    mode: input.mode,
    topK: input.topK,
    engines: {
      embed: semantic?.embed ?? { state: 'skipped' },
      semantic: semantic?.semantic ?? { state: 'skipped' },
      keyword: keyword?.keyword ?? { state: 'skipped' },
    },
    totalMs: Date.now() - started,
    results: explain(input.query, input.mode, semantic?.hits ?? [], keyword?.hits ?? [], input.topK),
  }
}

export interface DocumentRow {
  id: string
  title: string
  status: string
  source: { id: string; name: string; kind: string }
  chars: number
  chunks: number
  embeddedChunks: number
  updatedAt: string
}

export async function listDocuments(tenantId: string, botId: string) {
  const documents = await prisma.document.findMany({
    where: { tenantId, knowledgeSource: { botId, tenantId } },
    select: { id: true, title: true, status: true, content: true, updatedAt: true, knowledgeSource: { select: { id: true, name: true, kind: true } } },
    orderBy: [{ knowledgeSource: { name: 'asc' } }, { title: 'asc' }],
    take: 500,
  })
  if (documents.length === 0) return []
  const counts = await prisma.$queryRawUnsafe<Array<{ documentId: string; chunks: number; embedded: number; chars: number }>>(
    `SELECT "documentId", count(*)::int AS chunks, count(embedding)::int AS embedded, coalesce(sum(length(content)), 0)::int AS chars
       FROM "document_chunks" WHERE "tenantId" = $1 AND "documentId" = ANY($2::text[]) GROUP BY "documentId"`,
    tenantId, documents.map((doc) => doc.id),
  )
  const byDoc = new Map(counts.map((row) => [row.documentId, row]))
  return documents.map((doc) => {
    const c = byDoc.get(doc.id)
    return {
      doc,
      row: {
        id: doc.id,
        title: doc.title,
        status: doc.status,
        source: doc.knowledgeSource,
        chars: Math.max(doc.content.length, c?.chars ?? 0),
        chunks: c?.chunks ?? 0,
        embeddedChunks: c?.embedded ?? 0,
        updatedAt: doc.updatedAt.toISOString(),
      } satisfies DocumentRow,
    }
  })
}

export async function documentChunks(tenantId: string, botId: string, documentId: string) {
  const doc = await prisma.document.findFirst({ where: { id: documentId, tenantId, knowledgeSource: { botId } }, select: { id: true, title: true, content: true } })
  if (!doc) return null
  const chunks = await prisma.$queryRawUnsafe<Array<{ id: string; content: string; embedded: boolean }>>(
    `SELECT id, content, (embedding IS NOT NULL) AS embedded FROM "document_chunks"
      WHERE "tenantId" = $1 AND "documentId" = $2 ORDER BY "createdAt" ASC, id ASC LIMIT 500`,
    tenantId, documentId,
  )
  return { id: doc.id, title: doc.title, text: doc.content, chunks }
}
