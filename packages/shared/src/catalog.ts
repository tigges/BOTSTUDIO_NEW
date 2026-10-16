/**
 * Studio facts the charts look up: services, prices, hours, address.
 * The public page stays a Source. This catalog is what Bella speaks.
 */

export const CATALOG_ENTITY = 'studio-catalog'

export type CatalogKind = 'service' | 'studio' | 'offer' | 'policy'

export interface CatalogFact {
  id: string
  kind: CatalogKind
  title: string
  phrases: string[]
  fact: string
  source?: string
}

export interface StudioCatalog {
  facts: CatalogFact[]
}

export interface CatalogValue {
  value: string
  synonyms: string[]
  id?: string
  kind?: CatalogKind
  fact?: string
  source?: string
}

export function emptyCatalog(): StudioCatalog {
  return { facts: [] }
}

export function catalogFromValues(values: unknown): StudioCatalog {
  if (!Array.isArray(values)) return emptyCatalog()
  const facts: CatalogFact[] = []
  for (const row of values) {
    if (!row || typeof row !== 'object') continue
    const item = row as CatalogValue
    const title = String(item.value ?? '').trim()
    const fact = String(item.fact ?? '').trim()
    if (!title || !fact) continue
    const synonyms = Array.isArray(item.synonyms) ? item.synonyms.map((phrase) => String(phrase)) : []
    facts.push({
      id: String(item.id ?? title).trim() || title,
      kind: item.kind === 'service' || item.kind === 'studio' || item.kind === 'offer' || item.kind === 'policy' ? item.kind : 'service',
      title,
      phrases: synonyms.length > 0 ? synonyms : [title.toLowerCase()],
      fact,
      source: typeof item.source === 'string' ? item.source : undefined,
    })
  }
  return { facts }
}

export function valuesFromCatalog(catalog: StudioCatalog): CatalogValue[] {
  return catalog.facts.map((fact) => ({
    value: fact.title,
    synonyms: fact.phrases,
    id: fact.id,
    kind: fact.kind,
    fact: fact.fact,
    source: fact.source,
  }))
}

export function factsForKind(catalog: StudioCatalog, kind?: string): CatalogFact[] {
  if (!kind) return catalog.facts
  return catalog.facts.filter((fact) => fact.kind === kind)
}
