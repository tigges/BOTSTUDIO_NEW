/**
 * A public website becomes a draft welcome: one greeting, then where the
 * place is, the hours, the prices, or how to book. Anything the pages do not
 * state is left off. The Bella prices and the Rosewood Lane address stay in
 * the hair studio template.
 */

import { SALON_WELCOME_NAME } from './salon-pack.js'
import type { StarterFlow } from './flow-templates.js'

export interface ScannedLink {
  href: string
  text: string
}

export interface ScannedPage {
  url: string
  title: string
  text: string
  links: ScannedLink[]
}

export interface ScanDoor {
  title: string
  flowName: string
  blurb: string
  answer: string
  found: boolean
}

export interface ScanFact {
  label: string
  text: string
}

export interface WebsiteChatDraft {
  url: string
  pages: string[]
  greeting: string
  doors: ScanDoor[]
  facts: ScanFact[]
  note: string
  flows: StarterFlow[]
  faqs: Array<{ question: string; answer: string; tags: string[] }>
  intents: Array<{ name: string; description: string; utterances: string[]; responses: Array<{ text: string }> }>
  documents: Array<{ title: string; url: string; content: string }>
}

const DOORS: Array<{ flowName: string; title: string; phrases: string[]; question: string }> = [
  {
    flowName: 'Location',
    title: 'Where we are',
    phrases: ['where are you', 'address', 'directions', 'where is the salon', 'how do I get there'],
    question: 'Where are you?',
  },
  {
    flowName: 'Salon hours',
    title: 'Hours',
    phrases: ['opening hours', 'salon hours', 'when are you open', 'what time do you open', 'hours', 'are you open'],
    question: 'What are your opening hours?',
  },
  {
    flowName: 'Services and prices',
    title: 'Services',
    phrases: ['how much', 'prices', 'price list', 'how much is a haircut', 'services', 'what does it cost'],
    question: 'How much is a haircut?',
  },
  {
    flowName: 'Book an appointment',
    title: 'Book',
    phrases: ['book', 'booking', 'book an appointment', 'appointment', 'make an appointment'],
    question: 'How do I book an appointment?',
  },
]

const BOOKING_HOSTS: Array<{ host: string; label: string }> = [
  { host: 'phorest.com', label: 'Phorest' },
  { host: 'fresha.com', label: 'Fresha' },
  { host: 'booksy.com', label: 'Booksy' },
  { host: 'calendly.com', label: 'Calendly' },
  { host: 'setmore.com', label: 'Setmore' },
  { host: 'simplybook.me', label: 'SimplyBook' },
  { host: 'vagaro.com', label: 'Vagaro' },
  { host: 'squareup.com', label: 'Square' },
  { host: 'square.site', label: 'Square' },
]

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => {
      const code = Number(num)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
    })
}

function visibleText(html: string): string {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeHtml(stripped).replace(/\s+/g, ' ').trim()
}

/** One fetched page, ready for the draft. Scripts and styles are already gone. */
export function pageFromHtml(url: string, html: string): ScannedPage {
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const links: ScannedLink[] = []
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]?.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const raw = href?.[2] ?? href?.[3] ?? href?.[4] ?? ''
    if (!raw || raw.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(raw)) continue
    const text = visibleText(match[2] ?? '').slice(0, 160)
    links.push({ href: raw, text })
  }
  return { url, title, text: visibleText(html), links }
}

function companyLabel(companyName: string): string {
  const trimmed = companyName.trim()
  return trimmed || 'the studio'
}

function handleFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function ask(id: string, x: number, y: number, label: string, question: string, variable: string) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind: 'ask_question', label, config: { question, variable } } }
}

function answerFlow(name: string, answer: string): StarterFlow {
  const y = 120
  return {
    name,
    description: 'From the public website. Edit the line if the page was wrong.',
    tags: ['website', 'faq'],
    publish: false,
    graph: {
      nodes: [
        { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: name, config: {} } },
        { id: 'say', type: 'flow-node', position: { x: 340, y }, data: { kind: 'send_message', label: 'Answer', config: { text: answer } } },
        { id: 'end', type: 'flow-node', position: { x: 640, y }, data: { kind: 'end_flow', label: 'End', config: {} } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'say', sourceHandle: 'out' },
        { id: 'e2', source: 'say', target: 'end' },
      ],
    },
  }
}

function welcomeFlow(company: string, persona: string, doors: ScanDoor[]): StarterFlow {
  const greeting = `Hi, I'm ${persona} at ${company}. What's your name?`
  const routes = doors.map((door) => {
    const spec = DOORS.find((item) => item.flowName === door.flowName)
    return {
      handle: handleFor(door.flowName),
      phrases: spec?.phrases ?? [door.flowName.toLowerCase()],
      flowName: door.flowName,
    }
  })
  const y = 80
  const followY = 360
  const nodes: object[] = [
    { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'save', type: 'flow-node', position: { x: 300, y }, data: { kind: 'set_variable', label: 'Keep the request', config: { variable: 'topic', value: '{{_last_user_message}}' } } },
    ask('welcome', 540, y, 'Welcome', greeting, 'guest_name'),
    { id: 'route', type: 'flow-node', position: { x: 820, y }, data: { kind: 'route_topic', label: 'Route', config: { routes } } },
    ask('follow', 820, followY, 'Ask', 'What would you like done?', 'request'),
    { id: 'route2', type: 'flow-node', position: { x: 1100, y: followY }, data: { kind: 'route_topic', label: 'Route the reply', config: { routes } } },
  ]
  const edges: object[] = [
    { id: 'e-start', source: 'start', target: 'save' },
    { id: 'e-save', source: 'save', target: 'welcome' },
    { id: 'e-welcome', source: 'welcome', target: 'route' },
    { id: 'e-other', source: 'route', target: 'follow', sourceHandle: 'other' },
    { id: 'e-follow', source: 'follow', target: 'route2' },
    { id: 'e-other-2', source: 'route2', target: 'follow', sourceHandle: 'other' },
  ]
  doors.forEach((door, index) => {
    const handle = handleFor(door.flowName)
    const jumpId = `go-${handle}`
    nodes.push({
      id: jumpId,
      type: 'flow-node',
      position: { x: 1280, y: y + index * 120 },
      data: { kind: 'execute_flow', label: door.flowName, config: { flowName: door.flowName } },
    })
    edges.push({ id: `e-${handle}`, source: 'route', target: jumpId, sourceHandle: handle })
    edges.push({ id: `e2-${handle}`, source: 'route2', target: jumpId, sourceHandle: handle })
  })
  return {
    name: SALON_WELCOME_NAME,
    description: `One greeting from the website, then where ${company} is, the hours, the prices, or booking`,
    tags: ['welcome', 'routing', 'website'],
    publish: false,
    graph: { nodes, edges },
  }
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i

function extractAddress(text: string): string | null {
  const match = POSTCODE.exec(text)
  const rawPostcode = match?.[1]
  if (!match || match.index === undefined || !rawPostcode) return null
  const compact = rawPostcode.toUpperCase().replace(/\s+/g, '')
  const postcode = compact.replace(/^(.+?)(\d[A-Z]{2})$/, '$1 $2')
  const tail = text.slice(Math.max(0, match.index - 140), match.index)
  const streets = [...tail.matchAll(/\d+\s+[A-Za-z0-9][^.]{2,100}/g)]
  const street = (streets[streets.length - 1]?.[0] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[,\s]+$/g, '')
    .replace(/^.*\b(?:at|address)\s+/i, '')
  if (!/^\d+\s+\S+/.test(street)) return null
  return `${street}, ${postcode}`
}

const DAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thurs?|fri|sat|sun'
const DAY_RANGE = `(?:${DAY})(?:\\s*(?:to|–|—|-|and|&)\\s*(?:${DAY}))*`
const CLOCK = '\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?'

function titleDays(value: string): string {
  const small = new Set(['to', 'and', 'or'])
  const words = value.replace(/&/g, ' and ').replace(/[–—-]/g, ' to ').toLowerCase().split(/\s+/).filter(Boolean)
  return words.map((word, index) => (
    small.has(word) && index > 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
  )).join(' ')
}

function tidyTime(value: string): string {
  return value.replace(/\s+/g, '').replace(/(\d)(am|pm)/i, (_, hour: string, mer: string) => `${hour}${mer.toLowerCase()}`)
}

function parseHoursSlice(slice: string): string | null {
  const ranges: string[] = []
  const rangeRe = new RegExp(`\\b(${DAY_RANGE})\\s+(${CLOCK})\\s*(?:to|–|—|-)\\s*(${CLOCK})`, 'gi')
  for (const match of slice.matchAll(rangeRe)) {
    const line = `${titleDays(match[1] ?? '')} ${tidyTime(match[2] ?? '')} to ${tidyTime(match[3] ?? '')}`
    if (!ranges.includes(line)) ranges.push(line)
  }
  const closed: string[] = []
  const closedRe = new RegExp(`\\b(${DAY_RANGE})\\s+(?:are\\s+)?closed\\b`, 'gi')
  for (const match of slice.matchAll(closedRe)) {
    const line = `${titleDays(match[1] ?? '')} closed`
    if (!closed.includes(line)) closed.push(line)
  }
  if (ranges.length === 0) return null
  return [...ranges, ...closed].join('. ').replace(/\.$/, '') + '.'
}

function extractHours(text: string): string | null {
  const marks = [...text.matchAll(/\b(?:opening hours|open)\b/gi)]
  for (const mark of marks) {
    const parsed = parseHoursSlice(text.slice(mark.index ?? 0, (mark.index ?? 0) + 320))
    if (parsed) return parsed
  }
  return null
}

function extractPrices(text: string): Array<{ id: string; label: string; amount: number }> {
  const keys: Array<{ id: string; label: string; words: string[] }> = [
    { id: 'highlights', label: 'Highlights', words: ['highlight', 'balayage', 'foiliage'] },
    { id: 'colour', label: 'Colour', words: ['colour', 'color'] },
    { id: 'treatments', label: 'Treatments', words: ['treatment', 'filler', 'smoothing', 'blow-dry', 'blow dry'] },
    { id: 'cut', label: 'A cut', words: ['haircut', ' cut', 'styling'] },
  ]
  const found = new Map<string, { id: string; label: string; amount: number }>()
  for (const match of text.matchAll(/from\s*£\s*(\d+)/gi)) {
    const amount = Number(match[1])
    if (!Number.isFinite(amount)) continue
    const window = text.slice(Math.max(0, (match.index ?? 0) - 90), match.index ?? 0).toLowerCase()
    let best: { id: string; label: string; at: number } | null = null
    for (const key of keys) {
      for (const word of key.words) {
        const at = window.lastIndexOf(word)
        if (at >= 0 && (!best || at > best.at)) best = { id: key.id, label: key.label, at }
      }
    }
    if (!best || found.has(best.id)) continue
    found.set(best.id, { id: best.id, label: best.label, amount })
  }
  return ['cut', 'colour', 'highlights', 'treatments'].flatMap((id) => {
    const hit = found.get(id)
    return hit ? [hit] : []
  })
}

function extractPatch(text: string): string | null {
  if (!/patch test/i.test(text)) return null
  const hours = text.match(/(\d+)\s*hours?\s+before/i)
  return `Colour needs a patch test at least ${hours?.[1] ?? '48'} hours before.`
}

function extractOffer(text: string): string | null {
  const match = text.match(/Every\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\d+%\s+off[^.]{0,90})/i)
  const day = match?.[1]
  const deal = match?.[2]
  if (!day || !deal) return null
  return `Every ${day}, ${deal.replace(/\s+/g, ' ').trim()}.`
}

function extractPhone(text: string): string | null {
  const match = text.match(/\b(0\d{2,4}\s\d{3,4}\s\d{3,4})\b/)
  return match?.[1] ?? null
}

function absoluteLink(href: string, base: string): string | null {
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

function extractBooking(pages: ScannedPage[]): { url: string; label: string } | null {
  for (const page of pages) {
    let origin = ''
    try { origin = new URL(page.url).origin } catch { origin = '' }
    for (const link of page.links) {
      const href = absoluteLink(link.href, page.url)
      if (!href) continue
      let host = ''
      try { host = new URL(href).hostname.replace(/^www\./, '') } catch { continue }
      const known = BOOKING_HOSTS.find((item) => host === item.host || host.endsWith(`.${item.host}`))
      if (known) return { url: href, label: known.label }
      const path = new URL(href).pathname.toLowerCase()
      if (origin && href.startsWith(origin) && /book|appointment/.test(path)) {
        return { url: href, label: 'the booking page' }
      }
    }
  }
  return null
}

function priceSentence(prices: Array<{ label: string; amount: number }>): string {
  if (prices.length === 0) return ''
  return prices.map((price, index) => (
    index === 0 ? `${price.label} starts from £${price.amount}.` : `${price.label} from £${price.amount}.`
  )).join(' ')
}

function priceBlurb(prices: Array<{ id: string; amount: number }>, patch: string | null): string {
  const bits = prices
    .filter((price) => price.id === 'cut' || price.id === 'colour')
    .map((price) => `${price.id === 'cut' ? 'Cut' : 'Colour'} from £${price.amount}`)
  if (bits.length === 0) {
    bits.push(...prices.slice(0, 2).map((price) => `From £${price.amount}`))
  }
  const hours = patch?.match(/(\d+)\s+hours/i)?.[1]
  if (hours) bits.push(`Patch test ${hours} hours before colour`)
  return bits.join('. ') + (bits.length ? '.' : '')
}

/** The map, the charts, and the knowledge lines. No network. */
export function draftWebsiteChat(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
}): WebsiteChatDraft {
  const pages = input.pages.filter((page) => page.text.trim().length > 0)
  const company = companyLabel(input.companyName)
  const persona = input.personaName?.trim() || 'Bella'
  const text = pages.map((page) => page.text).join('\n')
  const address = extractAddress(text)
  const hours = extractHours(text)
  const prices = extractPrices(text)
  const patch = extractPatch(text)
  const offer = extractOffer(text)
  const phone = extractPhone(text)
  const booking = extractBooking(pages)
  const pricesSpoken = priceSentence(prices)

  const locationAnswer = address
    ? `${company} is at ${address}.${phone ? ` The phone number is ${phone}.` : ''}`
    : 'The pages did not state an address.'
  const hoursAnswer = hours
    ? `${company} is open ${hours}`
    : 'The pages did not state opening hours.'
  const servicesAnswer = [pricesSpoken, patch].filter(Boolean).join(' ') || 'The pages did not state prices.'
  const bookAnswer = booking
    ? `Book on ${booking.label}: ${booking.url}`
    : 'The pages did not show a booking link. The studio can confirm a time in this chat.'

  const doors: ScanDoor[] = [
    {
      title: 'Where we are',
      flowName: 'Location',
      blurb: address ?? 'The pages did not state an address.',
      answer: locationAnswer,
      found: Boolean(address),
    },
    {
      title: 'Hours',
      flowName: 'Salon hours',
      blurb: hours ?? 'The pages did not state opening hours.',
      answer: hoursAnswer,
      found: Boolean(hours),
    },
    {
      title: 'Services',
      flowName: 'Services and prices',
      blurb: prices.length > 0 ? priceBlurb(prices, patch) : 'The pages did not state prices.',
      answer: servicesAnswer,
      found: prices.length > 0,
    },
    {
      title: 'Book',
      flowName: 'Book an appointment',
      blurb: booking ? `Booking opens on ${booking.label}.` : 'The pages did not show a booking link.',
      answer: bookAnswer,
      found: Boolean(booking),
    },
  ]

  const facts: ScanFact[] = []
  if (address) facts.push({ label: 'Contact', text: phone ? `${address}. ${phone}` : address })
  if (hours) facts.push({ label: 'Hours', text: hours })
  if (pricesSpoken) facts.push({ label: 'Prices', text: pricesSpoken.replace(/\.$/, '') })
  if (patch) facts.push({ label: 'Colour', text: patch })
  if (offer) facts.push({ label: 'Offers', text: offer })
  facts.push({ label: 'Site', text: 'The rest of the pages stays in Knowledge.' })

  const cancel = /[^.!?]{0,40}\bcancel(?:lation|led)?\b[^.!?]*[.!?]/i.exec(text)
  const note = cancel
    ? ''
    : 'Left off the map. The pages do not state a cancellation rule.'
  if (cancel?.[0]) facts.splice(facts.length - 1, 0, { label: 'Policy', text: cancel[0].replace(/\s+/g, ' ').trim() })

  const greeting = `Hi, I'm ${persona} at ${company}. What's your name?`
  const flows = [welcomeFlow(company, persona, doors), ...doors.map((door) => answerFlow(door.flowName, door.answer))]
  const faqs = DOORS.map((spec) => {
    const door = doors.find((item) => item.flowName === spec.flowName)
    return {
      question: spec.question,
      answer: door?.answer ?? '',
      tags: ['website', handleFor(spec.flowName)],
    }
  }).filter((faq) => faq.answer.length > 0)
  if (patch) faqs.push({ question: 'Do I need a patch test?', answer: patch, tags: ['website', 'patch-test'] })
  if (offer) faqs.push({ question: 'What offers do you have?', answer: offer, tags: ['website', 'offers'] })

  const intents = DOORS.map((spec) => {
    const door = doors.find((item) => item.flowName === spec.flowName)
    return {
      name: spec.flowName,
      description: spec.question,
      utterances: spec.phrases,
      responses: [{ text: door?.answer ?? '' }],
    }
  })

  const first = pages[0]
  return {
    url: first?.url ?? '',
    pages: pages.map((page) => page.url),
    greeting,
    doors,
    facts,
    note,
    flows,
    faqs,
    intents,
    documents: pages.map((page) => ({
      title: page.title || page.url,
      url: page.url,
      content: page.text.slice(0, 20_000),
    })),
  }
}
