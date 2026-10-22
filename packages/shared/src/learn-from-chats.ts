/**
 * Drafts a shorter chart from sample transcripts or from helpful chats
 * that repeat the same request. The draft stays unpublished.
 * A new chat still starts with no remembered name.
 */

import { NAME_QUESTION, usableContactName } from './contact-speech.js'
import { introLine } from './greeting-welcome.js'

export const LEARNING_TAG = 'learning'
export const LEARNING_KEEPS = 'greeting first, one question after hi, a new chat starts with no remembered name.'
/** One helpful chat is not a pattern. */
export const MIN_REPEAT = 3

export const BELLA_SAMPLE = [
  'Visitor: Can I book a colour?',
  "Bella: Hi, I'm Bella from Bella Hair Studio.",
  'Bella: I can book that.',
  "Bella: What's your name?",
  'Visitor: Sophie',
  'Bella: Have you been to us before?',
  'Visitor: I have not been before',
  'Bella: Would Saturday morning or a weekday after 5 suit you? The studio will confirm the exact time in this chat.',
].join('\n')

export interface ChatTurn {
  role: 'visitor' | 'bot'
  text: string
}

export interface RatedChatInput {
  rating: number
  visitorLines: string[]
  botLines: string[]
}

export interface LearnPreviewLine {
  role: 'visitor' | 'bot'
  text: string
}

export interface LearnGraph {
  nodes: LearnNode[]
  edges: LearnEdge[]
}

export interface LearnNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: { kind: string; label: string; config: Record<string, unknown> }
}

export interface LearnEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

export interface LearnSuggestion {
  phrase: string
  sentence: string
  fromLabel: string
  keeps: string
  flowName: string
  greeting: string
  preview: LearnPreviewLine[]
  graph: LearnGraph
}

export interface WeekCounts {
  finished: number
  helpful: number
  notHelpful: number
}

const VISITOR_LABELS = new Set(['visitor', 'customer', 'user', 'guest', 'client'])
const BOT_LABELS = new Set(['bot', 'bella', 'agent', 'assistant', 'studio'])
const GREETING = /^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening)[!?.\s]*$/i
const LEAD = /^(?:can i|could i|i want to|i'd like to|id like to|i would like to|please|i need to|i need|help me)\s+/
const MENU = /what would you like|how can i help|which you need|choose an option|what do you need/i
const UNSAFE = /deposit|card details|secure link|payment link|https?:\/\/|£\s*20\b|\$\s*20\b/i
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const URL = /https?:\/\/\S+/gi
const CARD = /\b(?:\d[ -]*?){13,19}\b/g
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g

export function weekSummary(rows: Array<{ finished: boolean; rating: number | null }>): WeekCounts {
  let finished = 0
  let helpful = 0
  let notHelpful = 0
  for (const row of rows) {
    if (row.finished) finished += 1
    if (row.rating === 1) helpful += 1
    else if (row.rating === -1) notHelpful += 1
  }
  return { finished, helpful, notHelpful }
}

export function suggestionFromSamples(text: string, company: string): LearnSuggestion | null {
  const chats = text
    .split(/^\s*---\s*$/m)
    .map((chunk) => parseOneTranscript(chunk))
    .filter((turns) => turns.length > 0)
  return suggestionFromTurns(chats, company, 'sample')
}

export function suggestionFromRated(chats: RatedChatInput[], company: string): LearnSuggestion | null {
  const helpful = chats.filter((chat) => chat.rating === 1).map((chat) => toTurns(chat))
  return suggestionFromTurns(helpful, company, 'helpful')
}

export function graphKeepsLearning(graph: unknown): boolean {
  if (!graph || typeof graph !== 'object') return false
  const nodes = (graph as { nodes?: LearnNode[] }).nodes
  if (!Array.isArray(nodes)) return false
  return nodes.some((node) => {
    const routes = node?.data?.config?.['routes']
    return Array.isArray(routes) && routes.some((route) => {
      return !!route && typeof route === 'object' && (route as { learning?: boolean }).learning === true
    })
  })
}

/** Point the phrase at the learned flow and leave every other route in place. */
export function applyLearningRoute(graph: LearnGraph, phrase: string, flowName: string): LearnGraph {
  const next = JSON.parse(JSON.stringify(graph)) as LearnGraph
  const handle = handleFor(flowName)
  const needle = phrase.toLowerCase()
  const routers = next.nodes.filter((node) => node.data.kind === 'route_topic')
  if (routers.length === 0) return graph

  for (const node of routers) {
    const routes = readRoutes(node).map((route) => {
      if (route.flowName === flowName || route.handle === handle) return route
      return { ...route, phrases: route.phrases.filter((item) => item.toLowerCase() !== needle) }
    }).filter((route) => route.phrases.length > 0)
    if (!routes.some((route) => route.flowName === flowName || route.handle === handle)) {
      routes.push({ handle, phrases: [phrase], flowName, learning: true })
    }
    for (const route of routes) {
      if (route.flowName !== flowName && route.handle !== handle) continue
      route.learning = true
      if (!route.phrases.some((item) => item.toLowerCase() === needle)) route.phrases.push(phrase)
    }
    node.data.config['routes'] = routes
  }

  const execId = `go-${handle}`
  if (!next.nodes.some((node) => node.id === execId)) {
    next.nodes.push({
      id: execId,
      type: 'flow-node',
      position: { x: 1100, y: 40 },
      data: { kind: 'execute_flow', label: flowName, config: { flowName } },
    })
  }
  for (const node of routers) {
    if (next.edges.some((edge) => edge.source === node.id && edge.sourceHandle === handle)) continue
    next.edges.push({ id: `${node.id}-${handle}`, source: node.id, target: execId, sourceHandle: handle })
  }

  const allowed = new Map<string, Set<string>>()
  for (const node of next.nodes) {
    if (node.data.kind !== 'route_topic') continue
    allowed.set(node.id, new Set([...readRoutes(node).map((route) => route.handle), 'other']))
  }
  next.edges = next.edges.filter((edge) => {
    const handles = allowed.get(edge.source)
    if (!handles) return true
    return !!edge.sourceHandle && handles.has(edge.sourceHandle)
  })
  return dropUnreachable(next)
}

export function learningMeta(graph: unknown): {
  phrase: string
  sentence: string
  fromLabel: string
  keeps: string
  preview: LearnPreviewLine[]
} | null {
  if (!graph || typeof graph !== 'object') return null
  const nodes = (graph as LearnGraph).nodes
  if (!Array.isArray(nodes)) return null
  const start = nodes.find((node) => node.data?.kind === 'trigger_start')
  const meta = start?.data?.config?.['learning']
  if (!meta || typeof meta !== 'object') return null
  const record = meta as {
    phrase?: unknown
    sentence?: unknown
    fromLabel?: unknown
    keeps?: unknown
    preview?: unknown
  }
  if (typeof record.phrase !== 'string' || typeof record.sentence !== 'string' || typeof record.fromLabel !== 'string') return null
  const preview = Array.isArray(record.preview)
    ? record.preview.flatMap((line) => {
      if (!line || typeof line !== 'object') return []
      const role = (line as { role?: unknown }).role
      const text = (line as { text?: unknown }).text
      if ((role !== 'visitor' && role !== 'bot') || typeof text !== 'string') return []
      return [{ role, text } satisfies LearnPreviewLine]
    })
    : []
  return {
    phrase: record.phrase,
    sentence: record.sentence,
    fromLabel: record.fromLabel,
    keeps: typeof record.keeps === 'string' ? record.keeps : LEARNING_KEEPS,
    preview,
  }
}

function suggestionFromTurns(chats: ChatTurn[][], company: string, source: 'sample' | 'helpful'): LearnSuggestion | null {
  const counted = new Map<string, { count: number; chats: ChatTurn[][] }>()
  for (const turns of chats) {
    const phrase = firstRequest(turns.filter((turn) => turn.role === 'visitor').map((turn) => turn.text))
    if (!phrase) continue
    const bucket = counted.get(phrase) ?? { count: 0, chats: [] }
    bucket.count += 1
    bucket.chats.push(turns)
    counted.set(phrase, bucket)
  }
  let best: { phrase: string; count: number; chats: ChatTurn[][] } | undefined
  for (const [phrase, bucket] of counted) {
    if (source === 'helpful' && bucket.count < MIN_REPEAT) continue
    if (!best || bucket.count > best.count) best = { phrase, count: bucket.count, chats: bucket.chats }
  }
  if (!best) return null

  const names = visitorNames(best.chats.flat())
  const botLines = best.chats.flat().filter((turn) => turn.role === 'bot').map((turn) => turn.text)
  const greeting = greetingFrom(botLines, company)
  const { ack, question } = shortenedLines(botLines, names, best.phrase)
  const sentence = sentenceFor(best.phrase)
  const fromLabel = source === 'sample'
    ? `From ${best.count} sample ${best.count === 1 ? 'chat' : 'chats'}.`
    : `From ${best.count} helpful chats.`
  const preview = previewLines(best.phrase, greeting, ack)
  const graph = learnedGraph({ greeting, ack, question, phrase: best.phrase, sentence, fromLabel, preview })
  return {
    phrase: best.phrase,
    sentence,
    fromLabel,
    keeps: LEARNING_KEEPS,
    flowName: `Learned: ${best.phrase}`,
    greeting,
    preview,
    graph,
  }
}

function toTurns(chat: RatedChatInput): ChatTurn[] {
  const turns: ChatTurn[] = []
  const visitors = chat.visitorLines.filter((line) => line.trim())
  const bots = chat.botLines.filter((line) => line.trim())
  const length = Math.max(visitors.length, bots.length)
  for (let index = 0; index < length; index += 1) {
    const visitor = visitors[index]
    const bot = bots[index]
    if (visitor) turns.push({ role: 'visitor', text: visitor.trim() })
    if (bot) turns.push({ role: 'bot', text: bot.trim() })
  }
  return turns
}

function parseOneTranscript(text: string): ChatTurn[] {
  const raw: Array<{ label: string; text: string }> = []
  let current: { label: string; text: string } | null = null
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^:]{1,40}):\s*(.*)$/)
    const label = match?.[1]
    if (label && !label.includes('http')) {
      current = { label: label.trim(), text: match?.[2] ?? '' }
      raw.push(current)
      continue
    }
    if (current && line.trim()) current.text = `${current.text} ${line.trim()}`.trim()
  }
  const roles = new Map<string, 'visitor' | 'bot'>()
  for (const row of raw) {
    const key = row.label.toLowerCase()
    if (VISITOR_LABELS.has(key)) roles.set(row.label, 'visitor')
    else if (BOT_LABELS.has(key)) roles.set(row.label, 'bot')
    else if (/^Hi, I'm /i.test(row.text)) roles.set(row.label, 'bot')
  }
  const unknown = [...new Set(raw.map((row) => row.label))].filter((label) => !roles.has(label))
  if (unknown.length === 1) {
    const otherIsBot = [...roles.values()].includes('bot')
    roles.set(unknown[0]!, otherIsBot ? 'visitor' : 'visitor')
  } else if (unknown.length >= 2) {
    roles.set(unknown[0]!, 'visitor')
    roles.set(unknown[1]!, 'bot')
  }
  return raw.flatMap((row) => {
    const role = roles.get(row.label)
    const spoken = row.text.trim()
    if (!role || !spoken) return []
    return [{ role, text: spoken }]
  })
}

function firstRequest(lines: string[]): string | null {
  for (const line of lines) {
    const phrase = requestPhrase(line)
    if (phrase) return phrase
  }
  return null
}

function requestPhrase(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed || GREETING.test(trimmed) || looksLikeName(trimmed) || UNSAFE.test(trimmed)) return null
  if (EMAIL.test(trimmed)) return null
  EMAIL.lastIndex = 0
  let text = trimmed.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim()
  text = text.replace(LEAD, '').trim()
  if (!text || GREETING.test(text) || text.length < 3 || text.length > 60) return null
  if (EMAIL.test(text) || URL.test(text)) return null
  EMAIL.lastIndex = 0
  URL.lastIndex = 0
  return text
}

function looksLikeName(line: string): boolean {
  const name = usableContactName(line)
  if (!name || line.includes('?')) return false
  if (/\b(book|booking|colour|color|cut|price|cancel|appointment|hour|where|help|want|need)\b/i.test(name)) return false
  return name.split(' ').length <= 3
}

function visitorNames(turns: ChatTurn[]): string[] {
  const names = new Set<string>()
  for (const turn of turns) {
    if (turn.role !== 'visitor' || !looksLikeName(turn.text)) continue
    const name = usableContactName(turn.text)
    if (!name) continue
    names.add(name)
    const first = name.split(' ')[0]
    if (first && first.length > 2) names.add(first)
  }
  return [...names]
}

function greetingFrom(botLines: string[], company: string): string {
  for (const line of botLines) {
    const match = line.match(/Hi, I'm [^.\n]{1,80}\./)
    if (!match) continue
    if (UNSAFE.test(match[0]) || /@/.test(match[0])) continue
    return match[0]
  }
  return introLine(null, company)
}

function shortenedLines(botLines: string[], names: string[], phrase: string): { ack: string; question: string | null } {
  const pieces = botLines.flatMap((line) => sentences(redact(line, names)))
  const safe = pieces.filter((line) => line && !UNSAFE.test(line) && !/@/.test(line) && !/^Hi, I'm /i.test(line))
  const ack = safe.find((line) => !line.includes('?') && !isNameQuestion(line) && !MENU.test(line))
  const question = safe.find((line) => line.includes('?') && !isNameQuestion(line) && !MENU.test(line) && (line.match(/\?/g) ?? []).length === 1)
  const booking = /\b(book|booking|appointment|colour|color|cut)\b/.test(phrase)
  return {
    ack: ack ?? (booking ? 'I can book that.' : 'I can help with that.'),
    question: question ?? null,
  }
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean)
}

function redact(text: string, names: string[]): string {
  let out = text.replace(URL, '').replace(EMAIL, '').replace(CARD, '').replace(PHONE, '')
  const sorted = [...names].sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    out = out.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '{{contact.name}}')
  }
  return out.replace(/\s+/g, ' ').trim()
}

function isNameQuestion(text: string): boolean {
  return text.includes(NAME_QUESTION)
}

function sentenceFor(phrase: string): string {
  const booking = /\b(book|booking|appointment|colour|color|cut|hair)\b/.test(phrase)
  const destination = booking ? 'the booking' : 'that answer'
  return `People who already say “${phrase}” skip the menu and go straight to ${destination}.`
}

function previewLines(phrase: string, greeting: string, ack: string): LearnPreviewLine[] {
  const bot = [greeting, ack, NAME_QUESTION].filter(Boolean).join('\n\n')
  return [
    { role: 'visitor', text: phrase },
    { role: 'bot', text: bot },
  ]
}

function learnedGraph(input: {
  greeting: string
  ack: string
  question: string | null
  phrase: string
  sentence: string
  fromLabel: string
  preview: LearnPreviewLine[]
}): LearnGraph {
  const y = 80
  const nodes: LearnNode[] = [
    node('start', 80, y, 'trigger_start', 'Start', {
      learning: {
        phrase: input.phrase,
        sentence: input.sentence,
        fromLabel: input.fromLabel,
        keeps: LEARNING_KEEPS,
        greeting: input.greeting,
        preview: input.preview,
      },
    }),
    node('ack', 320, y, 'send_message', 'Acknowledge', { text: input.ack }),
    node('named', 560, y, 'condition', 'Name known?', {
      conditions: [{ field: 'contact.name', operator: 'equals', value: 'there' }],
    }),
    node('name', 820, y - 140, 'ask_question', 'Name', { question: NAME_QUESTION, variable: 'guest_name' }),
  ]
  const edges: LearnEdge[] = [
    { id: 'e-start', source: 'start', target: 'ack' },
    { id: 'e-ack', source: 'ack', target: 'named' },
    { id: 'e-yes', source: 'named', target: 'name', sourceHandle: 'yes' },
  ]
  if (input.question) {
    nodes.push(node('follow', 1080, y, 'ask_question', 'Next question', { question: input.question, variable: 'detail' }))
    nodes.push(node('end', 1340, y, 'end_flow', 'End', {}))
    edges.push(
      { id: 'e-name', source: 'name', target: 'follow' },
      { id: 'e-no', source: 'named', target: 'follow', sourceHandle: 'no' },
      { id: 'e-follow', source: 'follow', target: 'end' },
    )
  } else {
    nodes.push(node('close', 1080, y, 'send_message', 'Close', { text: 'The studio will confirm this in the chat.' }))
    nodes.push(node('end', 1340, y, 'end_flow', 'End', {}))
    edges.push(
      { id: 'e-name', source: 'name', target: 'close' },
      { id: 'e-no', source: 'named', target: 'close', sourceHandle: 'no' },
      { id: 'e-close', source: 'close', target: 'end' },
    )
  }
  return { nodes, edges }
}

function node(id: string, x: number, y: number, kind: string, label: string, config: Record<string, unknown>): LearnNode {
  return { id, type: 'flow-node', position: { x, y }, data: { kind, label, config } }
}

function handleFor(flowName: string): string {
  return flowName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface RouteConfig {
  handle: string
  phrases: string[]
  flowName?: string
  learning?: boolean
}

function readRoutes(node: LearnNode): RouteConfig[] {
  const routes = node.data.config['routes']
  if (!Array.isArray(routes)) return []
  return routes.flatMap((route) => {
    if (!route || typeof route !== 'object') return []
    const handle = (route as { handle?: unknown }).handle
    const phrases = (route as { phrases?: unknown }).phrases
    if (typeof handle !== 'string' || !Array.isArray(phrases)) return []
    const flowName = (route as { flowName?: unknown }).flowName
    const learning = (route as { learning?: boolean }).learning === true
    return [{
      handle,
      phrases: phrases.filter((phrase): phrase is string => typeof phrase === 'string'),
      ...(typeof flowName === 'string' ? { flowName } : {}),
      ...(learning ? { learning: true } : {}),
    }]
  })
}

function dropUnreachable(graph: LearnGraph): LearnGraph {
  const start = graph.nodes.find((item) => item.data.kind === 'trigger_start' || item.data.kind === 'trigger')
  if (!start) return graph
  const outs = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const list = outs.get(edge.source) ?? []
    list.push(edge.target)
    outs.set(edge.source, list)
  }
  const seen = new Set<string>()
  const queue = [start.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const target of outs.get(id) ?? []) queue.push(target)
  }
  return {
    nodes: graph.nodes.filter((item) => seen.has(item.id)),
    edges: graph.edges.filter((edge) => seen.has(edge.source) && seen.has(edge.target)),
  }
}
