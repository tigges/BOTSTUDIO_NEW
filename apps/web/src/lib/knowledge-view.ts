import type { QualityLevel } from '@ybot/shared'

export interface TextPart {
  text: string
  hit: boolean
}

/** Splits text so the matched words can be marked where a word starts; matching ignores case. */
export function highlightParts(text: string, terms: string[]): TextPart[] {
  const words = [...new Set(terms.filter((term) => term.length > 0))].sort((a, b) => b.length - a.length)
  if (words.length === 0) return [{ text, hit: false }]
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu')
  return text.split(pattern).filter((part) => part.length > 0).map((part) => ({ text: part, hit: words.includes(part.toLowerCase()) }))
}

export interface DocumentFilter {
  text: string
  sourceId: string
  level: QualityLevel | ''
}

export function filterDocuments<T extends { title: string; source: { id: string; name: string }; quality: { level: QualityLevel } }>(docs: T[], filter: DocumentFilter): T[] {
  const needle = filter.text.trim().toLowerCase()
  return docs.filter((doc) =>
    (!needle || doc.title.toLowerCase().includes(needle) || doc.source.name.toLowerCase().includes(needle))
    && (!filter.sourceId || doc.source.id === filter.sourceId)
    && (!filter.level || doc.quality.level === filter.level),
  )
}

export function levelCounts(docs: Array<{ quality: { level: QualityLevel } }>): Record<QualityLevel, number> {
  const counts: Record<QualityLevel, number> = { good: 0, fair: 0, poor: 0, pending: 0 }
  for (const doc of docs) counts[doc.quality.level] += 1
  return counts
}

export function clampTopK(value: number): number {
  if (!Number.isFinite(value)) return 5
  return Math.min(20, Math.max(1, Math.round(value)))
}
