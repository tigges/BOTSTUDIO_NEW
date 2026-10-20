import type { CatalogFact, StudioCatalog } from '../catalog.js'
import type { EvalScenario } from '../evals.js'
import type { StarterFlow } from '../flow-templates.js'
import type { GuardrailRule } from '../guardrails.js'
import type { ScannedPage } from '../website-scan.js'
import type { BlueprintFieldSpec, BusinessDocument, BusinessProfile } from './business.js'

/** A scripted guest for the demo bot: what they type, and what the person in the Inbox replies. */
export interface DemoScript {
  id: string
  title: string
  guest: string[]
  agent?: string[]
}

/** Everything a blueprint installs on a new bot, compiled from one business profile. */
export interface BlueprintBundle {
  flows: StarterFlow[]
  catalog: StudioCatalog
  documents: BusinessDocument[]
  guardrails: { name: string; rules: GuardrailRule[] }
  evals: { name: string; scenarios: EvalScenario[] }
  /** Words that always reach a person, ahead of any chapter. */
  alwaysHuman: string[]
  /** The hours people answer the queue, from the business's own opening hours. */
  queueHours: { start: string; end: string; timezone: string } | null
  /** The bot's own prompt for answers outside the chapters. */
  systemPrompt: string
}

export interface Blueprint {
  id: string
  version: number
  name: string
  summary: string
  /** What the wizard calls the business ("practice", "studio"). */
  businessNoun: string
  persona: string
  accent: string
  fields: BlueprintFieldSpec[]
  /** Chapter names in the order the map shows them. */
  chapters: string[]
  sample(): BusinessProfile
  extract(pages: ScannedPage[], at?: string): BusinessProfile
  /** The facts the chapters look up. Recompiled whenever the business details change. */
  catalog(profile: BusinessProfile): StudioCatalog
  bundle(profile: BusinessProfile): BlueprintBundle
  demoScripts: DemoScript[]
}

export type { CatalogFact }
