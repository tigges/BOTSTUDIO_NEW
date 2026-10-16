import type { StudioCatalog } from '@ybot/shared'
import type { FlowGraph, GraphEdge, GraphNode } from './engine.js'
import { matchTopic, type TopicRoute } from './topic-route.js'

const SMALL_TALK = /^(hi|hello|hey|hiya|yo|thanks|thank you|cheers|ok|okay|good morning|good afternoon|good evening)[!?.\s]*$/i

export function isSmallTalk(text: string): boolean {
  return SMALL_TALK.test(text.trim())
}

export function isWelcomeName(name: string): boolean {
  return /welcome/i.test(name.trim())
}

function routeList(node: GraphNode): Array<{ handle: string; phrases: string[] }> {
  if (node.data.kind !== 'route_topic') return []
  return ((node.data.config['routes'] as Array<{ handle?: string; phrases?: string[] }> | undefined) ?? [])
    .map((route) => ({ handle: String(route.handle ?? ''), phrases: route.phrases ?? [] }))
    .filter((route) => route.handle)
}

function jumpName(node: GraphNode | undefined): string | undefined {
  if (!node || node.data.kind !== 'execute_flow') return undefined
  const name = String(node.data.config['flowName'] ?? '').trim()
  return name || undefined
}

function catalogPhrases(catalog: StudioCatalog | undefined, chapter: string): string[] {
  if (!catalog) return []
  const phrases: string[] = []
  for (const fact of catalog.facts) {
    if (fact.source !== chapter) continue
    phrases.push(fact.title, ...fact.phrases)
  }
  return phrases
}

function outgoing(graph: FlowGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId)
}

function nodeById(graph: FlowGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]))
}

/** Phrases that stay on this chart, not the doors that leave it. */
export function phrasesFromGraph(graph: FlowGraph, extra: string[] = []): string[] {
  const nodes = nodeById(graph)
  const phrases = [...extra]
  for (const node of graph.nodes) {
    for (const route of routeList(node)) {
      const edge = outgoing(graph, node.id).find((item) => item.sourceHandle === route.handle)
      const target = jumpName(nodes.get(edge?.target ?? ''))
      if (target) continue
      phrases.push(...route.phrases)
    }
  }
  return phrases
}

function incomingPhrases(
  chapters: Array<{ name: string; graph: FlowGraph }>,
  target: string,
): string[] {
  const phrases: string[] = []
  for (const chapter of chapters) {
    const nodes = nodeById(chapter.graph)
    for (const node of chapter.graph.nodes) {
      if (jumpName(node) !== target) continue
      for (const edge of chapter.graph.edges.filter((item) => item.target === node.id)) {
        const source = nodes.get(edge.source)
        if (!source) continue
        const route = routeList(source).find((item) => item.handle === edge.sourceHandle)
        if (route) phrases.push(...route.phrases)
      }
    }
  }
  return phrases
}

function doorsFromWelcome(chapters: Array<{ name: string; graph: FlowGraph }>): string[] {
  const welcome = chapters.find((chapter) => isWelcomeName(chapter.name))
  if (!welcome) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (const node of welcome.graph.nodes) {
    const name = jumpName(node)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function shortName(name: string): string {
  const trimmed = name.replace(/^salon\s+/i, '').trim()
  if (/book/i.test(trimmed)) return 'a booking'
  if (/price|service/i.test(trimmed)) return 'prices'
  if (/hour/i.test(trimmed)) return 'hours'
  if (/location|where|address/i.test(trimmed)) return 'where we are'
  return trimmed.toLowerCase()
}

/** A next offer from the map, instead of asking the same question again. */
export function offerOnMap(chapters: Array<{ name: string; graph: FlowGraph }>, current?: string): string {
  const doors = doorsFromWelcome(chapters)
  const names = (doors.length > 0 ? doors : chapters.map((chapter) => chapter.name))
    .filter((name) => !isWelcomeName(name) && name !== current)
  const shown = names.slice(0, 4).map(shortName)
  if (shown.length === 0) return 'Tell me a little more about what you need.'
  if (shown.length === 1) return `I can help with ${shown[0]}. What would you like?`
  const last = shown.pop()
  return `I can help with ${shown.join(', ')}, or ${last}. What would you like?`
}

/**
 * Hear a chapter from the whole map: its name, the words that open it, and catalog facts.
 * The welcome is a hub, not a destination.
 */
export function listenForChapter(input: {
  chapters: Array<{ name: string; graph: FlowGraph }>
  catalog?: StudioCatalog
  text: string
  current?: string
}): string | undefined {
  const heard = input.text.trim()
  if (!heard || isSmallTalk(heard)) return undefined
  const withFacts: TopicRoute[] = []
  const withoutFacts: TopicRoute[] = []
  for (const chapter of input.chapters) {
    if (isWelcomeName(chapter.name) || chapter.name === input.current) continue
    const facts = catalogPhrases(input.catalog, chapter.name)
    const route = {
      handle: chapter.name,
      phrases: [
        chapter.name,
        ...facts,
        ...incomingPhrases(input.chapters, chapter.name),
        ...phrasesFromGraph(chapter.graph),
      ],
    }
    if (facts.length > 0) withFacts.push(route)
    else withoutFacts.push(route)
  }
  const routes = [...withFacts, ...withoutFacts]
  if (routes.length === 0) return undefined
  const handle = matchTopic(heard, routes)
  return handle === 'other' ? undefined : handle
}

export function sameQuestion(left?: string | null, right?: string | null): boolean {
  const a = (left ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const b = (right ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return Boolean(a) && a === b
}

export function questionFrom(text: string): string | undefined {
  const trimmed = text.trim()
  return trimmed.includes('?') ? trimmed : undefined
}
