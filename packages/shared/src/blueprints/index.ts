import type { Blueprint } from './blueprint.js'
import { DENTAL_BLUEPRINT } from './dental.js'

export * from './blueprint.js'
export * from './business.js'
export * from './extract.js'
export * from './dental.js'

export const BLUEPRINTS: Blueprint[] = [DENTAL_BLUEPRINT]

export function blueprintById(id: string | null | undefined): Blueprint | undefined {
  return BLUEPRINTS.find((blueprint) => blueprint.id === id)
}

/** What the wizard lists: no functions, just the card and the form. */
export function blueprintCards() {
  return BLUEPRINTS.map(({ id, version, name, summary, businessNoun, persona, accent, fields, chapters }) => ({
    id, version, name, summary, businessNoun, persona, accent, fields, chapters,
  }))
}
