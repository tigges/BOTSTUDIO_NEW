/**
 * Suggestions from the latest Journey test chat.
 * Known misses get a chart edit. A note stays on the review for the next apply.
 */

import { NAME_QUESTION } from './contact-speech.js'

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
  fromChapter?: string
  openedChapter?: string
  shouldOpen?: string
  heard?: string
  nodeIds?: string[]
  applyable: boolean
}

export type JourneyMark = 'error' | 'improve'

export interface JourneyMarks {
  chapters: Record<string, JourneyMark>
  doors: Record<string, Record<string, JourneyMark>>
  nodeIds: Record<string, JourneyMark>
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
  return graph.nodes.some((node) => node.data.kind === 'ask_question' && /want the hours/i.test(String(node.data.config['question'] ?? '')))
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

function isWelcomeChapter(name: string): boolean {
  return /welcome/i.test(name)
}

function doubleNameChapter(chapters: OptimizeChapter[]): OptimizeChapter | undefined {
  return chapters.find((chapter) => isWelcomeChapter(chapter.name) && nameAskNodes(chapter.graph).length >= 2)
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
  const hoursName = input.chapters.find((chapter) => /^salon hours$/i.test(chapter.name))?.name
    ?? input.chapters.find((chapter) => /hours/i.test(chapter.name) && !/welcome/i.test(chapter.name))?.name
    ?? 'Salon hours'
  const bookName = input.chapters.find((chapter) => /book/i.test(chapter.name))?.name ?? 'Book an appointment'
  const hoursAsk = input.lines.find((line) => line.role === 'assistant' && /want the hours/i.test(line.content))
  if (bookOpenedAfterHours(input.lines) && hoursChapter) {
    const opened = input.lines.find((line, index) => {
      if (index < 2) return false
      const ask = input.lines[index - 2]
      const heard = input.lines[index - 1]
      return line.role === 'assistant' && ask?.role === 'assistant' && /want the hours/i.test(ask.content)
        && heard?.role === 'user' && YES_HEARD.test(heard.content.trim())
    })
    findings.push({
      id: 'offer_yes',
      kind: 'offer_yes',
      title: 'Yes after the hours offer opened Book',
      detail: 'Want the hours? then ok should open Salon hours. Accept moves yes and ok onto that door.',
      chapterName: hoursAsk?.chapter || hoursChapter.name,
      fromChapter: hoursAsk?.chapter || hoursChapter.name,
      openedChapter: opened?.chapter || bookName,
      shouldOpen: hoursName,
      heard: 'ok',
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
        detail: 'The Location chart still hears ok as a booking. Accept moves yes and ok onto Salon hours.',
        chapterName: hoursChapter.name,
        fromChapter: hoursChapter.name,
        openedChapter: bookName,
        shouldOpen: hoursName,
        heard: 'ok',
        applyable: true,
      })
    }
  }

  const welcome = doubleNameChapter(input.chapters)
  if (namedTwiceInChat(input.lines) || welcome) {
    const chapter = welcome ?? input.chapters.find((item) => isWelcomeChapter(item.name))
    findings.push({
      id: 'name_once',
      kind: 'name_once',
      title: 'The greeting asked for a name twice',
      detail: 'Keep one What’s your name? The greeting stays a hello. The next step still asks once.',
      chapterName: chapter?.name,
      fromChapter: chapter?.name,
      openedChapter: chapter?.name,
      nodeIds: chapter ? nameAskNodes(chapter.graph).map((node) => node.id) : [],
      applyable: Boolean(chapter && nameAskNodes(chapter.graph).length >= 2),
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
      openedChapter: chrome.chapter,
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
      .filter((node) => node.data.kind === 'ask_question' && /want the hours/i.test(String(node.data.config['question'] ?? '')))
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

export function journeyMarksFor(findings: ChatFinding[]): JourneyMarks {
  const chapters: Record<string, JourneyMark> = {}
  const doors: Record<string, Record<string, JourneyMark>> = {}
  const nodeIds: Record<string, JourneyMark> = {}
  function door(chapter: string, name: string, mark: JourneyMark) {
    doors[chapter] = { ...doors[chapter], [name]: mark }
  }
  for (const finding of findings) {
    if (finding.openedChapter) chapters[finding.openedChapter] = 'error'
    if (finding.shouldOpen) chapters[finding.shouldOpen] = 'improve'
    if (finding.fromChapter && finding.openedChapter) door(finding.fromChapter, finding.openedChapter, 'error')
    if (finding.fromChapter && finding.shouldOpen) door(finding.fromChapter, finding.shouldOpen, 'improve')
    for (const id of finding.nodeIds ?? []) nodeIds[id] = 'error'
  }
  return { chapters, doors, nodeIds }
}

export function recommendationsForVotes(input: {
  findings: ChatFinding[]
  votes: Record<string, 'up' | 'down'>
}): ChatFinding[] {
  const down = Object.entries(input.votes).filter(([, vote]) => vote === 'down').map(([name]) => name.toLowerCase())
  if (down.length === 0) return []
  return input.findings.filter((finding) => {
    const names = [finding.openedChapter, finding.fromChapter, finding.chapterName, finding.shouldOpen]
      .filter(Boolean)
      .map((name) => String(name).toLowerCase())
    return names.some((name) => down.some((voted) => name === voted || name.includes(voted) || voted.includes(name)))
  })
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
