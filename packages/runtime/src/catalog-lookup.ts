import type { CatalogFact, StudioCatalog } from '@botstudio/shared'
import { factsForKind } from '@botstudio/shared'
import { listenables, matchTopic, pickTopic } from './topic-route.js'

export function matchCatalog(catalog: StudioCatalog | undefined, text: string, kind?: string): CatalogFact | undefined {
  if (!catalog) return undefined
  const pool = factsForKind(catalog, kind)
  if (pool.length === 0) return undefined
  const handle = matchTopic(text, pool.map((fact) => ({ handle: fact.id, phrases: fact.phrases })))
  if (handle === 'other') return undefined
  return pool.find((fact) => fact.id === handle)
}

function guestNamedFact(text: string, fact: CatalogFact): boolean {
  const hay = text.toLowerCase()
  return listenables([fact.title, ...fact.phrases]).some((needle) => needle.length >= 4 && hay.includes(needle))
}

/**
 * Phrase match first. On a miss, classify among this catalog's facts.
 * The guest still has to name the fact (title or a listen-phrase), so "prices" does not pick a haircut.
 */
export async function pickCatalog(
  catalog: StudioCatalog | undefined,
  text: string,
  kind?: string,
  llm?: unknown,
): Promise<CatalogFact | undefined> {
  const phrase = matchCatalog(catalog, text, kind)
  if (phrase) return phrase
  if (!catalog) return undefined
  const pool = factsForKind(catalog, kind)
  if (pool.length === 0) return undefined
  const handle = await pickTopic(
    text,
    pool.map((fact) => ({ handle: fact.id, phrases: [...fact.phrases, fact.title] })),
    llm,
  )
  if (handle === 'other') return undefined
  const fact = pool.find((item) => item.id === handle)
  if (!fact || !guestNamedFact(text, fact)) return undefined
  return fact
}
