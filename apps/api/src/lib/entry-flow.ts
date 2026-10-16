export interface EntryCandidate {
  publishedAt: Date | null
  flow: { name: string; tags: string[] }
}

export interface WorkingCopyCandidate extends EntryCandidate {
  flowId: string
  version: number
}

const ENTRY_NAMES = new Set(['Welcome & Routing', 'Product welcome', 'Salon welcome'])

export function isEntryFlow(flow: { name: string; tags: string[] }): boolean {
  return flow.tags.includes('welcome') || ENTRY_NAMES.has(flow.name)
}

/** Prefer the newest welcome flow. Other flows are destinations. */
export function pickEntry<T extends EntryCandidate>(versions: T[]): T | undefined {
  const welcome = versions.filter((version) => isEntryFlow(version.flow))
  const pool = welcome.length > 0 ? welcome : versions
  return [...pool].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))[0]
}

/** Newest saved graph for each chapter. Drafts count. */
export function newestByFlow<T extends WorkingCopyCandidate>(versions: T[]): T[] {
  const newest = new Map<string, T>()
  for (const row of [...versions].sort((a, b) => b.version - a.version)) {
    if (!newest.has(row.flowId)) newest.set(row.flowId, row)
  }
  return [...newest.values()]
}

/** Newest saved graph per chapter, then the welcome. Drafts count. */
export function pickWorkingCopy<T extends WorkingCopyCandidate>(versions: T[]): T | undefined {
  return pickEntry(newestByFlow(versions))
}
