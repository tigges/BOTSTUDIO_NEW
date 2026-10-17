/**
 * Suggestions from the latest Journey test chat.
 * Known misses get a chart edit. A note stays on the review for the next apply.
 */

import { NAME_QUESTION } from './contact-speech.js'
import { offersHoursNext } from './salon-pack.js'

export interface OptimizeGraph {
  nodes: Array<{
    id: string
    type?: string
    position?: { x: number; y: number }
    data: { kind: string; label?: string; config: Record<string, unknown> }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
  }>
}

export interface OptimizeChapter {
  name: string
  graph: OptimizeGraph
}

export interface ChatOptimizeLine {
  role: 'user' | 'assistant'
  content: string
  chapter?: string
}

export interface ChatOptimizeNote {
  lineContent: string
  text: string
}

export type ChatFindingKind = 'offer_yes' | 'name_once' | 'nav_chrome' | 'note'

export interface ChatFinding {
  id: string
  kind: ChatFindingKind
  title: string
  detail: string
  chapterName?: string
  applyable: boolean
}

export interface ChatOptimizeResult {
  findings: ChatFinding[]
  chapters: OptimizeChapter[]
}

const YES_HEARD = /^(yes|yeah|yep|ok|okay)([,!.\s]+please)?[!?.\s]*$/i
const YES_PHRASES = ['yes', 'yeah', 'yep', 'ok', 'okay']
const BOOK_ASK = /\b(been to us before|what would you like done|colour work|shall i book|when would suit)\b/i
const NAV_HEADINGS = /\b(Products?|Solutions?|Pricing|Resources?|Partners?|Company|Platform|Customers?|Get a demo|Free tools)\b/g

function unique(phrases: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const phrase of phrases) {
    const key = phrase.toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(phrase)
  }
  return out
}

function nodeText(node: OptimizeGraph['nodes'][number]): string {
  const config = node.data.config ?? {}
  return `${config['text'] ?? ''} ${config['question'] ?? ''}`
}

function routeList(node: OptimizeGraph['nodes'][number]): Array<{ handle: string; phrases: string[] }> {
  if (node.data.kind !== 'route_topic') return []
  return ((node.data.config['routes'] as Array<{ handle?: string; phrases?: string[] }> | undefined) ?? [])
    .map((route) => ({ handle: String(route.handle ?? ''), phrases: route.phrases ?? [] }))
    .filter((route) => route.handle)
}

function asksHours(graph: OptimizeGraph): boolean {
  return graph.nodes.some((node) => node.data.kind === 'ask_question' && offersHoursNext(String(node.data.config['question'] ?? '')))
}

function nameAskNodes(graph: OptimizeGraph): OptimizeGraph['nodes'] {
  return graph.nodes.filter((node) => /what's your name/i.test(nodeText(node)))
}

function looksLikeNavChrome(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return false
  const headings = compact.match(NAV_HEADINGS) ?? []
  if (headings.length >= 4) return true
  const chunks = compact.split(/[·|•,/]|\s{2,}/).map((part) => part.trim()).filter((part) => part.length > 0 && part.length < 28)
  return chunks.length >= 5 && headings.length >= 2
}

function bookOpenedAfterHours(lines: ChatOptimizeLine[]): boolean {
  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines[index]
    if (line?.role !== 'assistant' || !/want the hours/i.test(line.content)) continue
    const heard = lines[index + 1]
    if (heard?.role !== 'user' || !YES_HEARD.test(heard.content.trim())) continue
    const next = lines[index + 2]
    if (!next || next.role !== 'assistant') return true
    if (BOOK_ASK.test(next.content) || /book/i.test(next.chapter ?? '')) return true
    if (/hours|monday|tuesday|wednesday|thursday|friday|saturday|open/i.test(next.content)) return false
  }
  return false
}

function hoursOfferChapter(chapters: OptimizeChapter[]): OptimizeChapter | undefined {
  return chapters.find((chapter) => asksHours(chapter.graph))
    ?? chapters.find((chapter) => /^location$/i.test(chapter.name))
}

function doubleNameChapter(chapters: OptimizeChapter[]): OptimizeChapter | undefined {
  return chapters.find((chapter) => nameAskNodes(chapter.graph).length >= 2)
}

function namedTwiceInChat(lines: ChatOptimizeLine[]): boolean {
  return lines.filter((line) => line.role === 'assistant' && /what's your name/i.test(line.content)).length >= 2
}

export function findingsFromChat(input: {
  lines: ChatOptimizeLine[]
  chapters: OptimizeChapter[]
  notes?: ChatOptimizeNote[]
}): ChatFinding[] {
  const findings: ChatFinding[] = []
  const hoursChapter = hoursOfferChapter(input.chapters)
  if (bookOpenedAfterHours(input.lines) && hoursChapter) {
    findings.push({
      id: 'offer_yes',
      kind: 'offer_yes',
      title: 'Yes after the hours offer opened Book',
      detail: 'Want the hours? then ok should open Salon hours. Apply moves yes and ok onto that door.',
      chapterName: hoursChapter.name,
      applyable: true,
    })
  } else if (hoursChapter && asksHours(hoursChapter.graph)) {
    const routes = hoursChapter.graph.nodes.flatMap(routeList)
    const hours = routes.find((route) => route.handle === 'hours')
    const book = routes.find((route) => route.handle === 'book')
    const hoursHearsYes = Boolean(hours?.phrases.some((phrase) => YES_PHRASES.includes(phrase.toLowerCase())))
    const bookHearsYes = Boolean(book?.phrases.some((phrase) => YES_PHRASES.includes(phrase.toLowerCase())))
    if (bookHearsYes && !hoursHearsYes) {
      findings.push({
        id: 'offer_yes',
        kind: 'offer_yes',
        title: 'Yes after the hours offer still opens Book',
        detail: 'The Location chart still hears ok as a booking. Apply moves yes and ok onto Salon hours.',
        chapterName: hoursChapter.name,
        applyable: true,
      })
    }
  }

  const welcome = doubleNameChapter(input.chapters)
  if (welcome && (namedTwiceInChat(input.lines) || nameAskNodes(welcome.graph).length >= 2)) {
    findings.push({
      id: 'name_once',
      kind: 'name_once',
      title: 'The greeting asked for a name twice',
      detail: 'Keep one What’s your name? The greeting stays a hello. The next step still asks once.',
      chapterName: welcome.name,
      applyable: true,
    })
  }

  const chrome = input.lines.find((line) => line.role === 'assistant' && looksLikeNavChrome(line.content))
  if (chrome) {
    findings.push({
      id: 'nav_chrome',
      kind: 'nav_chrome',
      title: 'A reply looked like website navigation',
      detail: 'Product and pricing pages should answer, not the homepage menu. Scan the site again after the import fix.',
      chapterName: chrome.chapter,
      applyable: false,
    })
  }

  for (const [index, note] of (input.notes ?? []).entries()) {
    const text = note.text.trim()
    if (!text) continue
    findings.push({
      id: `note-${index}`,
      kind: 'note',
      title: 'A note on this chat',
      detail: text,
      applyable: false,
    })
  }
  return findings
}

function patchHoursOfferGraph(graph: OptimizeGraph): OptimizeGraph {
  const hoursAsks = new Set(
    graph.nodes
      .filter((node) => node.data.kind === 'ask_question' && offersHoursNext(String(node.data.config['question'] ?? '')))
      .map((node) => node.id),
  )
  const routeIds = new Set(graph.edges.filter((edge) => hoursAsks.has(edge.source)).map((edge) => edge.target))
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.data.kind !== 'route_topic') return node
      if (hoursAsks.size > 0 && !routeIds.has(node.id)) return node
      const routes = ((node.data.config['routes'] as Array<{ handle?: string; phrases?: string[] }> | undefined) ?? [])
      if (!routes.some((route) => route.handle === 'hours') || !routes.some((route) => route.handle === 'book')) return node
      return {
        ...node,
        data: {
          ...node.data,
          config: {
            ...node.data.config,
            routes: routes.map((route) => {
              const handle = String(route.handle ?? '')
              const phrases = route.phrases ?? []
              if (handle === 'hours') return { ...route, phrases: unique([...phrases, ...YES_PHRASES]) }
              if (handle === 'book') {
                return {
                  ...route,
                  phrases: phrases.filter((phrase) => !YES_PHRASES.includes(phrase.toLowerCase()) && phrase.toLowerCase() !== 'please'),
                }
              }
              return route
            }),
          },
        },
      }
    }),
  }
}

function stripNameFromGreeting(graph: OptimizeGraph): OptimizeGraph {
  const named = nameAskNodes(graph)
  if (named.length < 2) return graph
  const keepId = named.find((node) => {
    const question = String(node.data.config['question'] ?? '').trim()
    return question === NAME_QUESTION || question.replace(/[?]/g, '') === NAME_QUESTION.replace(/[?]/g, '')
  })?.id ?? named[named.length - 1]?.id
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id === keepId) return node
      const config = node.data.config ?? {}
      const next = { ...config }
      let changed = false
      for (const key of ['text', 'question'] as const) {
        const value = String(next[key] ?? '')
        if (!/what's your name/i.test(value)) continue
        const stripped = value.replace(/\s*what's your name\??/ig, '').replace(/\s+/g, ' ').trim()
        if (stripped !== value) {
          next[key] = stripped
          changed = true
        }
      }
      if (!changed) return node
      return { ...node, data: { ...node.data, config: next } }
    }),
  }
}

export function applyChatFindings(input: {
  chapters: OptimizeChapter[]
  findings: ChatFinding[]
}): ChatOptimizeResult {
  const wanted = new Set(input.findings.filter((finding) => finding.applyable).map((finding) => finding.kind))
  const chapters = input.chapters.map((chapter) => {
    let graph = chapter.graph
    if (wanted.has('offer_yes') && (asksHours(graph) || /^location$/i.test(chapter.name))) {
      graph = patchHoursOfferGraph(graph)
    }
    if (wanted.has('name_once') && nameAskNodes(graph).length >= 2) {
      graph = stripNameFromGreeting(graph)
    }
    return graph === chapter.graph ? chapter : { ...chapter, graph }
  })
  return { findings: input.findings, chapters }
}
