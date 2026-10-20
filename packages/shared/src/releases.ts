/**
 * Releases: a frozen copy of the whole journey that guests hear on an
 * environment. Publishing makes a new release; rollback points the
 * environment back at an older one. Releases are never edited.
 */

export interface ReleaseChapter {
  flowId: string
  /** The saved version the chapter was copied from. Step logs and sessions point here. */
  flowVersionId: string
  version: number
  name: string
  tags: string[]
  graph: unknown
}

export function parseReleaseChapters(raw: unknown): ReleaseChapter[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    if (typeof row['flowId'] !== 'string' || typeof row['flowVersionId'] !== 'string' || typeof row['name'] !== 'string') return []
    return [{
      flowId: row['flowId'],
      flowVersionId: row['flowVersionId'],
      version: typeof row['version'] === 'number' ? row['version'] : 0,
      name: row['name'],
      tags: Array.isArray(row['tags']) ? (row['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      graph: row['graph'] ?? { nodes: [], edges: [] },
    }]
  })
}

export interface ReleaseDiff {
  added: string[]
  removed: string[]
  changed: string[]
  unchanged: string[]
}

/** What a candidate changes compared with what guests hear now, by chapter name. */
export function releaseDiff(live: ReleaseChapter[], next: ReleaseChapter[]): ReleaseDiff {
  const before = new Map(live.map((chapter) => [chapter.flowId, chapter]))
  const after = new Map(next.map((chapter) => [chapter.flowId, chapter]))
  const diff: ReleaseDiff = { added: [], removed: [], changed: [], unchanged: [] }
  for (const chapter of next) {
    const old = before.get(chapter.flowId)
    if (!old) diff.added.push(chapter.name)
    else if (JSON.stringify(old.graph) !== JSON.stringify(chapter.graph) || old.name !== chapter.name) diff.changed.push(chapter.name)
    else diff.unchanged.push(chapter.name)
  }
  for (const chapter of live) if (!after.has(chapter.flowId)) diff.removed.push(chapter.name)
  return diff
}

/** The candidate when one chapter is published: what is live now with that chapter swapped in. */
export function withChapter(base: ReleaseChapter[], chapter: ReleaseChapter): ReleaseChapter[] {
  const index = base.findIndex((item) => item.flowId === chapter.flowId)
  if (index < 0) return [...base, chapter]
  return base.map((item, i) => (i === index ? chapter : item))
}
