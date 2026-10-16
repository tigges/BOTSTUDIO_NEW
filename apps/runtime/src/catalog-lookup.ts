import type { CatalogFact, StudioCatalog } from '@ybot/shared'
import { factsForKind } from '@ybot/shared'
import { matchTopic } from './topic-route.js'

export function matchCatalog(catalog: StudioCatalog | undefined, text: string, kind?: string): CatalogFact | undefined {
  if (!catalog) return undefined
  const pool = factsForKind(catalog, kind)
  if (pool.length === 0) return undefined
  const handle = matchTopic(text, pool.map((fact) => ({ handle: fact.id, phrases: fact.phrases })))
  if (handle === 'other') return undefined
  return pool.find((fact) => fact.id === handle)
}
