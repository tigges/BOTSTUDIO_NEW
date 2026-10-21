/**
 * How well a Knowledge document came through: enough readable text, not mostly
 * boilerplate, split into passages and embedded. Each problem says what the
 * reader sees and what to do, so the Documents view can list them as-is.
 */

export interface DocumentStats {
  status: string
  /** The source kind: website, url and file are read by extraction; business and text are typed in. */
  sourceKind: string
  /** Characters of text across the document and its passages. */
  chars: number
  /** Share of non-space characters that are letters, 0..1, from a sample of the text. */
  letterShare: number
  /** Share of non-empty lines that repeat an earlier line, 0..1. */
  repeatedLineShare: number
  chunks: number
  embeddedChunks: number
}

export type QualityLevel = 'good' | 'fair' | 'poor' | 'pending'

export interface DocumentQuality {
  /** 0..100; null while the document is still being read. */
  score: number | null
  level: QualityLevel
  issues: string[]
}

const SAMPLE = 20_000
const EXTRACTED_KINDS = new Set(['website', 'url', 'file'])

export function textStats(text: string): Pick<DocumentStats, 'letterShare' | 'repeatedLineShare'> {
  const sample = text.slice(0, SAMPLE)
  const visible = sample.replace(/\s+/g, '')
  const letters = visible.match(/\p{L}/gu)?.length ?? 0
  const lines = sample.split('\n').map((line) => line.trim().toLowerCase()).filter((line) => line.length > 2)
  const seen = new Set<string>()
  let repeated = 0
  for (const line of lines) {
    if (seen.has(line)) repeated += 1
    else seen.add(line)
  }
  return {
    letterShare: visible.length ? letters / visible.length : 0,
    repeatedLineShare: lines.length ? repeated / lines.length : 0,
  }
}

export function documentQuality(stats: DocumentStats): DocumentQuality {
  if (stats.status === 'failed') {
    return { score: 0, level: 'poor', issues: ['Reading this document failed. Sync the source again, or upload the file again.'] }
  }
  if (stats.status === 'processing' && stats.chunks === 0) {
    return { score: null, level: 'pending', issues: ['Still being read. Passages appear here when it is done.'] }
  }
  const issues: string[] = []
  let score = 100
  const extracted = EXTRACTED_KINDS.has(stats.sourceKind)
  const resync = stats.sourceKind === 'business' ? 'Save Business details again to index them.' : 'Sync the source to split it.'
  if (extracted && stats.chars < 200) {
    score -= 45
    issues.push(`Very little text came out (${stats.chars} characters). Scanned PDFs and pages built by scripts often read like this; upload a text version.`)
  }
  if (extracted && stats.chars >= 50 && stats.letterShare < 0.6) {
    score -= 25
    issues.push('Much of the text is symbols or numbers, so tables or layout may not have come through.')
  }
  if (extracted && stats.repeatedLineShare > 0.3) {
    score -= 20
    issues.push('Many lines repeat (menus, footers, cookie banners). Answers may quote them.')
  }
  if (stats.chunks === 0) {
    score -= 20
    issues.push(`Not split into passages, so only keyword search finds it. ${resync}`)
  } else if (stats.embeddedChunks < stats.chunks) {
    score -= 15
    const missing = stats.chunks - stats.embeddedChunks
    issues.push(`${missing} of ${stats.chunks} passages have no embedding, so semantic search skips them. ${stats.sourceKind === 'business' ? 'Save Business details again' : 'Sync the source'} once an embedding model is connected.`)
  }
  score = Math.max(0, score)
  return { score, level: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor', issues }
}
