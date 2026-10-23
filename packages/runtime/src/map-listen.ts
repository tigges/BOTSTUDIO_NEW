import type { StudioCatalog } from '@botstudio/shared'
import type { FlowGraph, GraphEdge, GraphNode } from './engine.js'
import { matchTopic, pickTopic, type TopicRoute } from './topic-route.js'

const SMALL_TALK = /^(hi|hello|hey|hiya|yo|thanks|thank you|cheers|ok|okay|good morning|good afternoon|good evening)[!?.\s]*$/i

export function isSmallTalk(text: string): boolean {
  return SMALL_TALK.test(text.trim())
}

const YES_TO_OFFER = /^(yes|yeah|yep|ok|okay)([,!.\s]+please)?[!?.\s]*$/i

/** "Want the hours?" then ok/yes is the hours chapter, not Book. */
export function acceptedHoursOffer(question: string | undefined, heard: string): boolean {
  if (!question || !heard) return false
  if (!/want the hours/i.test(question)) return false
  return YES_TO_OFFER.test(heard.trim())
}

export function hoursChapterName(chapters: Array<{ name: string }>): string | undefined {
  return chapters.find((chapter) => /^salon hours$/i.test(chapter.name) || /^hours$/i.test(chapter.name))?.name
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

const INSIDE_ANSWERS = new Set([
  'yes', 'yeah', 'yep', 'no', 'nope', 'ok', 'okay', 'please', 'both',
])

function keepOpenPhrase(phrase: string): boolean {
  const needle = phrase.toLowerCase().trim()
  return Boolean(needle) && needle.length >= 3 && !INSIDE_ANSWERS.has(needle)
}

/** Phrases that stay on this chart, not the doors that leave it, and not yes/no answers inside the walk. */
export function phrasesFromGraph(graph: FlowGraph, extra: string[] = []): string[] {
  const nodes = nodeById(graph)
  const phrases = [...extra]
  for (const node of graph.nodes) {
    for (const route of routeList(node)) {
      const edge = outgoing(graph, node.id).find((item) => item.sourceHandle === route.handle)
      const target = jumpName(nodes.get(edge?.target ?? ''))
      if (target) continue
      phrases.push(...route.phrases.filter(keepOpenPhrase))
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
  if (/emergenc|\bpain\b|urgent/i.test(trimmed)) return 'an urgent problem'
  if (/hour/i.test(trimmed)) return 'hours'
  if (/location|where|address/i.test(trimmed)) return 'where we are'
  return trimmed.toLowerCase()
}

const CORE_DOORS = ['Services and prices', 'Salon hours', 'Book an appointment', 'Location']

/** A chapter that only hands the chat to a person. The bot offers its own topics; asking for a person always works. */
export function isPersonDoor(name: string): boolean {
  return /\b(talk|speak|chat) (to|with)\b|\b(a person|human|someone|an agent|the team|reception(ist)?|staff)\b/i.test(name)
}

/** Up to three topics the bot can take a guest into, booking first, in the welcome's order. */
export function mapTopics(chapters: Array<{ name: string; graph: FlowGraph }>, current?: string): string[] {
  const doors = doorsFromWelcome(chapters)
  const names = (doors.length > 0 ? doors : chapters.map((chapter) => chapter.name))
    .filter((name) => !isWelcomeName(name) && name !== current && !isPersonDoor(name))
  const ranked = [
    ...names.filter((name) => /book/i.test(name)),
    ...CORE_DOORS.filter((name) => names.includes(name) && !/book/i.test(name)),
    ...names.filter((name) => !CORE_DOORS.includes(name) && !/book/i.test(name)),
  ]
  return [...new Set(ranked.slice(0, 3).map(shortName))]
}

function topicList(shown: string[]): string {
  if (shown.length === 1) return shown[0]!
  const rest = [...shown]
  const last = rest.pop()
  return `${rest.join(', ')}, or ${last}`
}

/** A next offer from the map, instead of asking the same question again. */
export function offerOnMap(chapters: Array<{ name: string; graph: FlowGraph }>, current?: string): string {
  const shown = mapTopics(chapters, current)
  if (shown.length === 0) return 'Tell me a little more about what you need.'
  return `I can help you with ${topicList(shown)}. What would you like?`
}

/**
 * The welcome did not recognise the answer. Every bot does the same here: no "didn't catch that"
 * twice and no handover, just a short apology and the topics, worded a little differently each time.
 */
export function welcomeMissReply(chapters: Array<{ name: string; graph: FlowGraph }>, misses: number): string {
  const shown = mapTopics(chapters)
  if (shown.length === 0) return 'Sorry, I didn\'t quite follow. Could you tell me a little more about what you need?'
  const list = topicList(shown)
  if (misses <= 1) return `Sorry, I didn't quite follow. I can help you with ${list}. What would you like?`
  if (misses === 2) return `I may be missing what you mean. The things I can help with here are ${list}. Which is closest?`
  return `I can help you with ${list}, or you can ask me a question in your own words.`
}

/** A real question or a sentence, worth answering from the knowledge base rather than re-offering topics. */
export function looksLikeQuestion(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((word) => /[a-z0-9]/i.test(word))
  if (words.length >= 5) return true
  return words.length >= 3 && /\?\s*$/.test(text.trim())
}

/** What the knowledge answer is told when the guest asked something the journey has no chapter for. */
export function steerInstruction(chapters: Array<{ name: string; graph: FlowGraph }>): string {
  const shown = mapTopics(chapters)
  const topics = shown.length ? ` The topics you can take them through are ${topicList(shown)}.` : ''
  return 'The guest asked something outside the guided topics. Answer briefly and only from the knowledge base. '
    + 'If the knowledge base does not cover it, say so in one sentence without guessing.'
    + topics
    + ' End with one short question that offers those topics. Do not say you are passing the chat to anyone.'
}

/** A reply may explain and then ask once. A second question is the next turn. */
export function keepFirstQuestion(text: string): string {
  const trimmed = text.trim()
  const first = trimmed.indexOf('?')
  if (first < 0) return trimmed
  const later = trimmed.indexOf('?', first + 1)
  if (later < 0) return trimmed
  return trimmed.slice(0, first + 1).trim()
}

function shortOption(title: string): string {
  const cleaned = title
    .replace(/wash,?\s*cut\s*(and|&)\s*style/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const first = (cleaned || title).split(/[,/]/)[0]?.trim() || title
  return first.charAt(0).toUpperCase() + first.slice(1)
}

function clipChoiceList(text: string): string {
  return text.replace(/\b(Which [^?\n]{1,80}\? )([^.?\n]+)\./g, (full, lead: string, listed: string) => {
    if (/or another/i.test(listed)) return full
    const parts = listed
      .split(/,\s*(?:or\s+)?(?=[A-Z])/)
      .map((part) => part.replace(/^\s*or\s+/i, '').replace(/\s+and a few more$/i, '').trim())
      .filter(Boolean)
    if (parts.length <= 1) return full
    const long = parts.some((part) => part.length > 18 || /wash/i.test(part))
    // Four short plan names (Free / Starter / Professional / Enterprise) stay spoken.
    if (!long && parts.length <= 4 && parts.every((part) => part.split(/\s+/).length <= 2)) return full
    if (parts.length <= 3 && !long) return full
    const labels = parts.slice(0, 3).map(shortOption)
    const more = parts.length > 3
    if (labels.length === 1) return `${lead}${labels[0]}.`
    const last = labels.pop()
    const joined = `${labels.join(', ')}, or ${last}`
    return more ? `${lead}${joined} — or another.` : `${lead}${joined}.`
  })
}

const OLD_NEXT: Array<{ find: RegExp; chapter: RegExp; next: string }> = [
  { find: /Want where we are, a price, or to book\?/i, chapter: /hour/i, next: 'Shall I book a time?' },
  { find: /Want the hours, a price, or to book\?/i, chapter: /location|where/i, next: 'Want the hours?' },
  { find: /Want another (?:price|question|offer), or shall we book\?/i, chapter: /.*/, next: 'Shall we book?' },
]

/**
 * One question per turn. A long which-one list becomes three short names.
 * Charts scanned before that still get the same shape at speak time.
 */
export function shapeTurn(text: string, chapter?: string): string {
  let spoken = clipChoiceList(keepFirstQuestion(text))
  if (chapter) {
    for (const rule of OLD_NEXT) {
      if (rule.chapter.test(chapter) && rule.find.test(spoken)) {
        spoken = spoken.replace(rule.find, rule.next)
      }
    }
  }
  return spoken
}

const COLOUR_SERVICE = /\b(colou?rs?|highlights?|balayage|foiliage)\b/i
const PRICE_ASK = /\b(how much|price|prices|cost|pricing)\b/i
const HOURS_ASK = /\b(hours?|opening|when are you open)\b/i
const WHERE_ASK = /\b(where|address|location|directions)\b/i
const CANCEL_ASK = /\b(cancel|cancellation)\b/i
const BOOK_ASK = /\b(book|booking|appointment)\b/i
const CUT_ASK = /\b(haircuts?|a cut|a trim|cut|fringe|services?)\b/i

/** A deal only when they ask for one. A weekday is a time, not a promotion. */
export function wantsOffer(text: string): boolean {
  return /\b(offers?|discounts?|promo|promotion|percent off|% off|half price|special offer)\b/i.test(text.trim())
}

/** A colour service word without a price or offer ask belongs on Book, not Offers. */
export function colourWantsBooking(text: string): boolean {
  const heard = text.trim()
  if (!COLOUR_SERVICE.test(heard)) return false
  if (PRICE_ASK.test(heard)) return false
  if (wantsOffer(heard)) return false
  return true
}

/** Leave the current question only when they clearly start something else. */
export function isTopicSwitch(text: string): boolean {
  const heard = text.trim()
  if (!heard || isSmallTalk(heard)) return false
  return colourWantsBooking(heard)
    || wantsOffer(heard)
    || PRICE_ASK.test(heard)
    || HOURS_ASK.test(heard)
    || WHERE_ASK.test(heard)
    || CANCEL_ASK.test(heard)
    || BOOK_ASK.test(heard)
    || CUT_ASK.test(heard)
}

/** Chapters a guest can open from this map, excluding the welcome they are already on. */
export function chapterRoutes(input: {
  chapters: Array<{ name: string; graph: FlowGraph }>
  catalog?: StudioCatalog
  text: string
  current?: string
}): TopicRoute[] {
  const withFacts: TopicRoute[] = []
  const withoutFacts: TopicRoute[] = []
  for (const chapter of input.chapters) {
    if (isWelcomeName(chapter.name) || chapter.name === input.current) continue
    if (/^offers?$/i.test(chapter.name) && !wantsOffer(input.text)) continue
    const route = chapterRoute(input.chapters, input.catalog, chapter)
    if (route.facts > 0) withFacts.push(route.route)
    else withoutFacts.push(route.route)
  }
  return [...withFacts, ...withoutFacts]
}

function chapterRoute(
  chapters: Array<{ name: string; graph: FlowGraph }>,
  catalog: StudioCatalog | undefined,
  chapter: { name: string; graph: FlowGraph },
): { route: TopicRoute; facts: number } {
  const facts = catalogPhrases(catalog, chapter.name)
  return {
    facts: facts.length,
    route: {
      handle: chapter.name,
      phrases: [chapter.name, ...facts, ...incomingPhrases(chapters, chapter.name), ...phrasesFromGraph(chapter.graph)],
    },
  }
}

/** "cancel it" inside Change or cancel is an answer there, not a reason to ask the model for another chapter. */
function heardCurrent(input: Parameters<typeof listenForChapter>[0]): boolean {
  const current = input.current ? input.chapters.find((chapter) => chapter.name === input.current) : undefined
  if (!current || isWelcomeName(current.name)) return false
  return matchTopic(input.text.trim(), [chapterRoute(input.chapters, input.catalog, current).route]) !== 'other'
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
  const book = input.chapters.find((chapter) => chapter.name === 'Book an appointment')
  if (book && colourWantsBooking(heard)) {
    return book.name === input.current ? undefined : book.name
  }
  const routes = chapterRoutes(input)
  if (routes.length === 0) return undefined
  const handle = matchTopic(heard, routes)
  return handle === 'other' ? undefined : handle
}

/**
 * Phrase match first. On a miss, ask the model to pick one of this map's chapters.
 * Empty llm stays unset, same as a phrase miss.
 */
export async function hearChapter(
  input: Parameters<typeof listenForChapter>[0],
  llm?: unknown,
): Promise<string | undefined> {
  const hit = listenForChapter(input)
  if (hit) return hit
  if (isSmallTalk(input.text)) return undefined
  if (heardCurrent(input)) return undefined
  const routes = chapterRoutes(input)
  if (routes.length === 0) return undefined
  const picked = await pickTopic(input.text, routes, llm)
  return picked === 'other' ? undefined : picked
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
