/**
 * The Journey page lays every chapter out from the handoffs in the graphs.
 * A chapter another chart jumps to sits under that chart. A suggested draft
 * sits beside the welcome. Anything with no line in stays loose.
 */

import { spokenLines, welcomeDoors } from './conversation-map.js'

export interface JourneyFlowInput {
  id: string
  name: string
  tags?: string[]
  published: boolean
  graph: unknown
}

export interface JourneyChapter {
  id: string
  name: string
  steps: string[]
  jumps: string[]
  welcome: boolean
  suggested: boolean
  published: boolean
  children: JourneyChapter[]
}

export interface JourneyLayout {
  roots: JourneyChapter[]
  suggested: JourneyChapter[]
  loose: JourneyChapter[]
}

const WELCOME_NAMES = new Set(['Welcome & Routing', 'Product welcome', 'Salon welcome', 'Corporate welcome'])

function isWelcome(flow: JourneyFlowInput): boolean {
  return (flow.tags ?? []).includes('welcome') || WELCOME_NAMES.has(flow.name)
}

function chapterFrom(flow: JourneyFlowInput, welcome: boolean, suggested: boolean): JourneyChapter {
  return {
    id: flow.id,
    name: flow.name,
    steps: spokenLines(flow.graph, 3),
    jumps: welcomeDoors(flow.graph).map((door) => door.flowName),
    welcome,
    suggested,
    published: flow.published,
    children: [],
  }
}

function pickWelcome(flows: JourneyFlowInput[]): JourneyFlowInput | undefined {
  const welcomes = flows.filter(isWelcome)
  return welcomes
    .slice()
    .sort((a, b) => {
      if (a.published !== b.published) return a.published ? -1 : 1
      return welcomeDoors(b.graph).length - welcomeDoors(a.graph).length
    })[0]
}

/** Chapters, the lines between them, and the drafts nothing has accepted yet. */
export function journeyLayout(flows: JourneyFlowInput[]): JourneyLayout {
  const byName = new Map<string, JourneyFlowInput>()
  for (const flow of flows) {
    if (!byName.has(flow.name)) byName.set(flow.name, flow)
  }
  const welcomeFlow = pickWelcome(flows)
  const built = new Map<string, JourneyChapter>()

  const welcomeJumps = new Set(welcomeFlow ? welcomeDoors(welcomeFlow.graph).map((door) => door.flowName) : [])

  function build(flow: JourneyFlowInput, welcome: boolean, suggested: boolean, stack: Set<string>): JourneyChapter {
    const existing = built.get(flow.id)
    if (existing) return existing
    const chapter = chapterFrom(flow, welcome, suggested)
    built.set(flow.id, chapter)
    const nextStack = new Set(stack)
    nextStack.add(flow.id)
    const seenChild = new Set<string>()
    for (const jump of chapter.jumps) {
      const target = byName.get(jump)
      if (!target || seenChild.has(target.id)) continue
      if (built.has(target.id) || nextStack.has(target.id)) continue
      // A welcome door stays on the welcome, even when a chapter can hand off to it.
      if (!welcome && welcomeJumps.has(target.name)) continue
      seenChild.add(target.id)
      chapter.children.push(build(target, false, false, nextStack))
    }
    return chapter
  }

  const roots: JourneyChapter[] = []
  if (welcomeFlow) roots.push(build(welcomeFlow, true, false, new Set()))

  const suggested: JourneyChapter[] = []
  for (const flow of flows) {
    if (built.has(flow.id)) continue
    const proposed = (flow.tags ?? []).includes('proposed') && !flow.published
    if (!proposed) continue
    suggested.push(build(flow, false, true, new Set()))
  }

  const loose: JourneyChapter[] = []
  if (!welcomeFlow) {
    const incoming = new Set<string>()
    for (const flow of flows) {
      if (built.has(flow.id)) continue
      for (const jump of welcomeDoors(flow.graph)) incoming.add(jump.flowName)
    }
    for (const flow of flows) {
      if (built.has(flow.id)) continue
      if (incoming.has(flow.name)) continue
      roots.push(build(flow, false, false, new Set()))
    }
  }
  for (const flow of flows) {
    if (built.has(flow.id)) continue
    loose.push(build(flow, false, false, new Set()))
  }

  return { roots, suggested, loose }
}

function walk(
  chapter: JourneyChapter,
  flowId: string,
  path: JourneyChapter[],
): JourneyChapter[] | null {
  const next = [...path, chapter]
  if (chapter.id === flowId) return next
  for (const child of chapter.children) {
    const found = walk(child, flowId, next)
    if (found) return found
  }
  return null
}

/** The chapters from the welcome down to this one, plus the jumps leaving it. */
export function journeyTrail(layout: JourneyLayout, flowId: string): { path: Array<{ id: string; name: string }>; next: string[] } {
  const pools = [...layout.roots, ...layout.suggested, ...layout.loose]
  for (const root of pools) {
    const found = walk(root, flowId, [])
    if (!found) continue
    const here = found[found.length - 1]
    return {
      path: found.map((chapter) => ({ id: chapter.id, name: chapter.name })),
      next: here?.jumps ?? [],
    }
  }
  return { path: [], next: [] }
}
