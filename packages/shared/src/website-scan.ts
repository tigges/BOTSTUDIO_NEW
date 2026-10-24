/**
 * A public website becomes a draft welcome.
 * Linked pages, such as a price list, questions, and a join-the-team page,
 * become short conversations: one question, one answer, then an offer to continue.
 * Anything the pages do not state is left off. The Bella prices and the
 * Rosewood Lane address stay in the hair studio template.
 */

import { bookAppointmentFlow } from './booking-walk.js'
import type { CatalogFact, StudioCatalog } from './catalog.js'
import { emptyCatalog } from './catalog.js'
import { BOOKING_HOSTS, namedLink } from './chat-links.js'
import { catalogLookupFlow, doorsForNextOffer, SALON_WELCOME_NAME } from './salon-pack.js'
import type { StarterFlow } from './flow-templates.js'
import { draftClusteredTemplate, isOpaqueStem, isStoryLeafPath, packFromLearned, suggestCluster, type ClusterId, type LearnedTemplateSpec } from './site-template.js'
import { identityFor } from './start-catalog.js'
import { introLine } from './greeting-welcome.js'
import { hoursFromStructuredData, hoursMentionedIn, hoursSentence, pickWeek } from './opening-hours.js'
import type { OpeningDay } from './blueprints/business.js'

export interface ScannedLink {
  href: string
  text: string
}

export interface ScannedPage {
  url: string
  title: string
  text: string
  links: ScannedLink[]
  /** The page's own summary from its meta description, when it has one. */
  description?: string
  /** Opening hours the page declares for search engines (schema.org), when it does. */
  hours?: OpeningDay[]
}

export interface ScanDoor {
  title: string
  flowName: string
  blurb: string
  answer: string
  found: boolean
  /** Welcome phrases. The chapter itself asks the narrower question. */
  phrases: string[]
}

export interface ScanFact {
  label: string
  text: string
}

export interface WebsiteChatDraft {
  url: string
  pages: string[]
  clusterId: ClusterId
  greeting: string
  doors: ScanDoor[]
  facts: ScanFact[]
  note: string
  flows: StarterFlow[]
  faqs: Array<{ question: string; answer: string; tags: string[] }>
  intents: Array<{ name: string; description: string; utterances: string[]; responses: Array<{ text: string }> }>
  documents: Array<{ title: string; url: string; content: string }>
  catalog: StudioCatalog
  booking: { url: string; label: string } | null
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
    phrases: ['how much', 'prices', 'price list', 'how much is a haircut', 'services', 'service', 'what does it cost', 'cut', 'a cut', 'trim', 'haircut'],
    question: 'How much is a haircut?',
  },
  {
    flowName: 'Book an appointment',
    title: 'Book',
    phrases: ['book', 'booking', 'book an appointment', 'appointment', 'make an appointment', 'colour', 'color', 'highlights', 'balayage'],
    question: 'How do I book an appointment?',
  },
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

const VOID_HTML = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** Sample charts (aria-hidden) and nav chrome are not the product. Leave them off the scan. */
function dropAriaHidden(html: string): string {
  const tag = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g
  const skip: string[] = []
  let out = ''
  let last = 0
  for (const match of html.matchAll(tag)) {
    const at = match.index ?? 0
    if (skip.length === 0) out += html.slice(last, at)
    last = at + match[0].length
    if (match[0].startsWith('<!--')) {
      if (skip.length === 0) out += match[0]
      continue
    }
    const name = (match[1] ?? '').toLowerCase()
    const closing = match[0].startsWith('</')
    const selfClosing = /\/\s*>$/.test(match[0]) || VOID_HTML.has(name)
    if (closing) {
      // Menus often leave <li> and <p> open; a closing tag also closes whatever it still holds.
      const open = skip.lastIndexOf(name)
      if (open >= 0) skip.length = open
      else if (skip.length === 0) out += match[0]
      continue
    }
    const hidden = /\baria-hidden\s*=\s*(?:"true"|'true'|true)/i.test(match[0]) || name === 'nav'
    if (skip.length > 0 || hidden) {
      if (!selfClosing) skip.push(name)
      continue
    }
    out += match[0]
  }
  if (skip.length === 0) out += html.slice(last)
  return out
}

function strippedHtml(html: string): string {
  return dropAriaHidden(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
}

function visibleText(html: string): string {
  return decodeHtml(strippedHtml(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Keeps headings, questions, and table rows on their own lines so a price list can be split. */
function pageText(html: string): string {
  const broken = strippedHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<t[dh]\b([^>]*)>/gi, (_, attrs: string) => {
      const label = String(attrs).match(/\bdata-label\s*=\s*("([^"]*)"|'([^']*)')/i)
      const name = label?.[2] ?? label?.[3] ?? ''
      return name ? ` ${name} ` : ' '
    })
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|summary|dt|dd|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
  return decodeHtml(broken)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/\s+\|/g, ' |').trim())
    .filter(Boolean)
    .join('\n')
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
  const description = metaDescription(html)
  const hours = hoursFromStructuredData(html)
  return { url, title, text: pageText(html), links, ...(description ? { description } : {}), ...(hours ? { hours } : {}) }
}

function metaDescription(html: string): string {
  for (const name of ['description', 'og:description']) {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
      if (key !== name) continue
      const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i)
      const text = decodeHtml(content?.[1] ?? content?.[2] ?? '').replace(/\s+/g, ' ').trim()
      if (text) return text
    }
  }
  return ''
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

function answerFlow(name: string, answer: string, ticket?: { subject: string; description: string }): StarterFlow {
  const y = 120
  const nodes: object[] = [
    { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: name, config: {} } },
    { id: 'say', type: 'flow-node', position: { x: 340, y }, data: { kind: 'send_message', label: 'Answer', config: { text: answer } } },
  ]
  const edges: object[] = [
    { id: 'e1', source: 'start', target: 'say', sourceHandle: 'out' },
  ]
  if (ticket) {
    nodes.push({ id: 'ticket', type: 'flow-node', position: { x: 560, y }, data: { kind: 'create_ticket', label: 'Inbox', config: ticket } })
    nodes.push({ id: 'end', type: 'flow-node', position: { x: 780, y }, data: { kind: 'end_flow', label: 'End', config: {} } })
    edges.push({ id: 'e2', source: 'say', target: 'ticket' })
    edges.push({ id: 'e3', source: 'ticket', target: 'end' })
  } else {
    nodes.push({ id: 'end', type: 'flow-node', position: { x: 640, y }, data: { kind: 'end_flow', label: 'End', config: {} } })
    edges.push({ id: 'e2', source: 'say', target: 'end' })
  }
  return {
    name,
    description: 'From the public website. Edit the catalog if the fact changed.',
    tags: ['website', 'faq'],
    publish: false,
    graph: { nodes, edges },
  }
}

function lookupDoor(name: string, id: string, intro: string, next: string): StarterFlow {
  return catalogLookupFlow({
    name,
    description: 'Looks up one fact from the scanned pages, then offers a next step.',
    id,
    intro,
    next,
    doors: doorsForNextOffer(next).filter((door) => door.flowName !== name),
    tags: ['website', 'faq'],
    publish: false,
  })
}

function welcomeFlow(company: string, persona: string, doors: ScanDoor[]): StarterFlow {
  const greeting = `${introLine(persona, company)} What's your name?`
  const routes = doors.map((door) => ({
    handle: handleFor(door.flowName),
    phrases: door.phrases.length > 0 ? door.phrases : [door.flowName.toLowerCase()],
    flowName: door.flowName,
  }))
  const y = 80
  const followY = 360
  const nodes: object[] = [
    { id: 'start', type: 'flow-node', position: { x: 80, y }, data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'save', type: 'flow-node', position: { x: 300, y }, data: { kind: 'set_variable', label: 'Keep the request', config: { variable: 'topic', value: '{{_last_user_message}}' } } },
    ask('welcome', 540, y, 'Welcome', greeting, 'guest_name'),
    { id: 'route', type: 'flow-node', position: { x: 820, y }, data: { kind: 'route_topic', label: 'Route', config: { routes } } },
    ask('follow', 820, followY, 'Ask', 'Are you after a price, the hours, or to book?', 'request'),
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
  const streets = [...tail.matchAll(/\b\d{1,4}[A-Za-z]?\s+[A-Za-z][^.]{2,100}/g)]
  const street = (streets[streets.length - 1]?.[0] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[,\s]+$/g, '')
    .replace(/^.*\b(?:at|address)\s+/i, '')
  if (!/^\d+\s+\S+/.test(street)) return null
  return `${street}, ${postcode}`
}

/** The week the pages state, as one line the bot can say. Any common layout; see opening-hours.ts. */
function extractHours(pages: ScannedPage[]): string | null {
  const picked = pickWeek(pages)
  return picked ? hoursSentence(picked.best.hours) || null : null
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

const JUNK_PATH = /\/(?:wp-admin|wp-json|feed|tag|category|author|sample-page|hello-world|cart|basket|checkout|login|account|search)(?:\/|$)/i
/** One item from a shop catalogue (/products/croissant). A sitemap can list hundreds; two say what is sold. */
const CATALOGUE_LEAF = /^\/(?:products?|collections|items?)\/[^/]+\/?$/i
const MAX_CATALOGUE_LEAVES = 2
const SKIP_PATH = /\/(?:blog|company-news|careers-blog|glossary|case-stud(?:y|ies)|bid|investors?|shareholders?|governance|annual-report|code-of-conduct|articles|videos)(?:\/|$|-[^/]*)/i
const ASSET_PATH = /\.(?:png|jpe?g|gif|svg|css|js|pdf|zip|webp|ico|mp4|xml)(?:\?|$)/i
const PAGE_RANK: Array<[string, number]> = [
  ['pricing', 8], ['price', 6], ['product', 6], ['plan', 5], ['sim', 8], ['tariff', 6], ['shop', 5],
  ['faq', 6], ['question', 6],
  ['career', 6], ['vacancy', 6], ['cv', 5], ['team', 5], ['service', 5], ['demo', 5],
  ['complain', 7], ['offer', 4], ['job', 4], ['contact', 4], ['menu', 4], ['integrat', 4], ['billing', 4],
  ['hour', 3], ['login', 3], ['platform', 3], ['feature', 3], ['crm', 3], ['mobile', 3],
  ['patch', 2], ['about', 4], ['help', 5], ['book', 2], ['visit', 1],
]
const PAGE_PENALTY: Array<[string, number]> = [
  ['/blog', 8], ['company-news', 8], ['glossary', 6], ['case-stud', 6], ['webinar', 4], ['/resources/', 3],
  ['investor', 8], ['shareholder', 8], ['computershare', 8], ['governance', 6], ['code of conduct', 6],
]

/**
 * Which same-origin pages to read after the homepage.
 * A price list, product page, or questions page outranks a blog post.
 * A pretty URL and a theme file for the same leaf still count once.
 * /products/marketing and /pricing/marketing are different pages.
 */
export function chooseSitePages(input: {
  homeUrl: string
  links: ScannedLink[]
  sitemap?: string[]
  limit: number
}): string[] {
  let home: URL
  try { home = new URL(input.homeUrl) } catch { return [] }
  const byKey = new Map<string, { href: string; score: number; pathLength: number; themeFile: boolean; stem: string }>()
  const consider = (href: string, text: string, bonus: number) => {
    let url: URL
    try { url = new URL(href, home) } catch { return }
    if (url.origin !== home.origin) return
    url.hash = ''
    url.search = ''
    if (url.pathname === '/' || url.pathname === '') return
    if (url.pathname.replace(/\/$/, '') === home.pathname.replace(/\/$/, '')) return
    if (JUNK_PATH.test(url.pathname) || ASSET_PATH.test(url.pathname) || SKIP_PATH.test(url.pathname)) return
    if (isStoryLeafPath(url.pathname)) return
    const stem = (url.pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.html?$/i, '').toLowerCase()
    if (!stem || stem === 'index' || isOpaqueStem(stem)) return
    const blob = `${url.pathname} ${text}`.toLowerCase()
    let score = bonus
    for (const [word, weight] of PAGE_RANK) {
      if (new RegExp(`(?:^|[^a-z0-9])${word}(?:[^a-z0-9]|$)`, 'i').test(blob)) score += weight
    }
    for (const [word, weight] of PAGE_PENALTY) {
      if (blob.includes(word)) score -= weight
    }
    if (url.pathname.includes('wp-content')) score -= 2
    const segments = url.pathname.split('/').filter(Boolean)
    if (/^\/(?:pricing|plans)(?:\/|$)/i.test(url.pathname)) score += 14
    if (/sim-only|pay-monthly|pay-as-you-go|\/shop(?:\/|$)/i.test(url.pathname)) score += 12
    if (/^\/products?\/[^/]+\/?$/i.test(url.pathname)) score += 5
    if (/^\/products?\/(marketing|sales|service|crm)\/?$/i.test(url.pathname)) score += 4
    if (segments.length <= 2 && /^(products?|pricing|plans|faq|questions?|team|about|sim-only|shop|mobile)$/i.test(segments[0] ?? '')) score += 3
    if (segments.length >= 3) score -= 3
    if (segments.length >= 4) score -= 5
    const pathLength = url.pathname.length
    const themeFile = /\/wp-content\/|\/themes\/|\/static\//i.test(url.pathname)
    const key = themeFile ? `stem:${stem}` : `path:${url.pathname.replace(/\/$/, '').toLowerCase()}`
    if (!themeFile) {
      byKey.delete(`stem:${stem}`)
    } else {
      for (const item of byKey.values()) {
        if (!item.themeFile && item.stem === stem) return
      }
    }
    const prev = byKey.get(key)
    const better = !prev || score > prev.score || (score === prev.score && pathLength < prev.pathLength)
    if (better) byKey.set(key, { href: url.href, score, pathLength, themeFile, stem })
  }
  for (const link of input.links) consider(link.href, link.text, 0)
  for (const loc of input.sitemap ?? []) consider(loc, '', 1)
  const ranked = [...byKey.values()].sort((a, b) => b.score - a.score || a.pathLength - b.pathLength)
  const shop = input.links.some((link) => /\/(?:cart|basket|collections)(?:\/|$)/i.test(link.href))
  const kept: typeof ranked = []
  let leaves = 0
  for (const item of ranked) {
    const leaf = shop && CATALOGUE_LEAF.test(new URL(item.href).pathname)
    if (leaf && leaves >= MAX_CATALOGUE_LEAVES) continue
    if (leaf) leaves += 1
    kept.push(item)
  }
  return kept
    .slice(0, Math.max(0, input.limit))
    .map((item) => item.href)
}

const SHOP_TLD = /(?:^|\.)(?:co\.uk|com\.au|co\.nz|co\.za|co\.in|com\.tr|ie|de|es|it|pt|nl|gr|ro|cz|hu|al|eg|gh|ke|tz)$/i
const SHOP_HINT = /shop|plans?|sim|mobile|tariff|pay[- ]?monthly|store|\bbuy\b/i
const ENGLISH_MARKET = /united kingdom|\buk\b|great britain|\bengland\b/i
const ENGLISH_HOST = /(?:^|\.)(?:co\.uk|uk|ie|com\.au|co\.nz|co\.za|co\.in|com\.sg|ca)$/i

function brandLabel(hostname: string): string {
  const host = hostname.replace(/^www\./, '').toLowerCase()
  const parts = host.split('.').filter(Boolean)
  if (parts.length >= 3 && /^(co|com|org|net|gov)$/i.test(parts[parts.length - 2] ?? '')) {
    return parts[parts.length - 3] ?? ''
  }
  return parts[parts.length - 2] ?? parts[0] ?? ''
}

function isShopHost(hostname: string): boolean {
  return SHOP_TLD.test(hostname.replace(/^www\./, '').toLowerCase())
}

/**
 * Group homepages (vodafone.com) often keep consumer plans on a country shop
 * (vodafone.co.uk). Follow one sibling shop, preferring an English market.
 * Already-on-a-shop hosts stay put.
 */
export function chooseShopHomes(input: {
  homeUrl: string
  links: ScannedLink[]
  limit?: number
}): string[] {
  let home: URL
  try { home = new URL(input.homeUrl) } catch { return [] }
  const brand = brandLabel(home.hostname)
  if (!brand || brand.length < 3) return []
  if (isShopHost(home.hostname)) return []
  const ranked: Array<{ href: string; score: number }> = []
  const seen = new Set<string>()
  for (const link of input.links) {
    let url: URL
    try { url = new URL(link.href, home) } catch { continue }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    if (url.origin === home.origin) continue
    if (brandLabel(url.hostname) !== brand) continue
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    // A language switcher (hubspot.com → hubspot.de) is not a shop: an English chat cannot quote German pages.
    if (!ENGLISH_HOST.test(host) && !ENGLISH_MARKET.test(link.text)) continue
    const href = `${url.protocol}//${url.hostname}/`
    if (seen.has(href)) continue
    let score = 2
    if (isShopHost(url.hostname)) score += 8
    if (SHOP_HINT.test(`${url.pathname} ${link.text}`)) score += 6
    if (ENGLISH_MARKET.test(link.text) || /\.co\.uk$/i.test(host)) score += 10
    const labels = host.split('.')
    if (labels[0] !== brand) score -= 6
    if (score < 8) continue
    seen.add(href)
    ranked.push({ href, score })
  }
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, input.limit ?? 1))
    .map((item) => item.href)
}

interface Spoke {
  title: string
  phrases: string[]
  say?: string
  choices?: Spoke[]
}

interface BuiltSpoke extends Spoke {
  handle: string
  choices?: BuiltSpoke[]
}

function clip(value: string, max = 280): string {
  const tidy = value.replace(/\s+/g, ' ').trim()
  if (tidy.length <= max) return tidy
  return `${tidy.slice(0, max - 1).replace(/\s+\S*$/, '')}.`
}

function slugHandle(title: string, used: Set<string>): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'item'
  let handle = base
  let n = 2
  while (used.has(handle) || handle === 'other' || handle === 'book') {
    handle = `${base}-${n}`
    n += 1
  }
  used.add(handle)
  return handle
}

function assignHandles(spokes: Spoke[], used: Set<string>): BuiltSpoke[] {
  return spokes.map((spoke) => ({
    ...spoke,
    handle: slugHandle(spoke.title, used),
    choices: spoke.choices ? assignHandles(spoke.choices, used) : undefined,
  }))
}

function leavesOf(spokes: BuiltSpoke[]): BuiltSpoke[] {
  const leaves: BuiltSpoke[] = []
  for (const spoke of spokes) {
    if (spoke.choices && spoke.choices.length > 0) leaves.push(...leavesOf(spoke.choices))
    else if (spoke.say) leaves.push(spoke)
  }
  return leaves
}

function flowNode(id: string, kind: string, label: string, config: Record<string, unknown>, x: number, y: number) {
  return { id, type: 'flow-node', position: { x, y }, data: { kind, label, config } }
}

/**
 * One question, then one answer, then an offer to continue.
 * A list the guest already named skips the first question.
 */
function conversationFlow(input: {
  name: string
  description: string
  intro: string
  again: string
  spokes: Spoke[]
  bookName: string | null
}): StarterFlow {
  const spokes = assignHandles(input.spokes, new Set())
  const leaves = leavesOf(spokes)
  const nodes: object[] = []
  const edges: object[] = []
  const link = (id: string, source: string, target: string, sourceHandle?: string) => {
    edges.push({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) })
  }
  const routesFor = (items: BuiltSpoke[]) => items.map((item) => ({
    handle: item.handle,
    phrases: item.phrases,
  }))
  const phraseCounts = new Map<string, number>()
  const tally = (items: BuiltSpoke[]) => {
    for (const item of items) {
      for (const phrase of item.phrases) phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
      if (item.choices) tally(item.choices)
    }
  }
  tally(spokes)
  const nameOf = (title: string) => title.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const nameCounts = new Map<string, number>()
  for (const item of new Map([...spokes, ...leaves].map((entry) => [entry.handle, entry])).values()) {
    nameCounts.set(nameOf(item.title), (nameCounts.get(nameOf(item.title)) ?? 0) + 1)
  }
  const seenOpen = new Set<string>()
  const openItems: BuiltSpoke[] = []
  for (const item of [...spokes, ...leaves]) {
    if (seenOpen.has(item.handle)) continue
    seenOpen.add(item.handle)
    // A shared word stays with the one item named exactly that ("roots" is Roots, not In-between roots).
    const ownName = nameOf(item.title)
    const phrases = item.phrases.filter((phrase) => (phraseCounts.get(phrase) ?? 0) < 2 || (phrase === ownName && nameCounts.get(ownName) === 1))
    if (phrases.length === 0) continue
    openItems.push({ ...item, phrases })
  }
  const openHandles = new Set(openItems.map((item) => item.handle))
  // "Full head" in both Colour and Highlights asks which, instead of "In-between full head" hearing its words.
  const sharedNames = [...nameCounts].filter(([name, count]) => count > 1 && name.length >= 3).map(([name]) => name)
  const sharedRoutes = sharedNames.map((name, index) => ({ handle: `same-name-${index + 1}`, phrases: [name] }))

  nodes.push(flowNode('start', 'trigger_start', 'Start', {}, 40, 80))
  nodes.push(flowNode('open', 'route_topic', 'If they already said', { routes: [...routesFor(openItems), ...sharedRoutes] }, 280, 80))
  link('e-start', 'start', 'open')
  nodes.push(flowNode('intro', 'ask_question', 'Ask', { question: input.intro, variable: 'request' }, 560, 80))
  link('e-open-other', 'open', 'intro', 'other')
  for (const route of sharedRoutes) link(`e-open-${route.handle}`, 'open', 'intro', route.handle)
  nodes.push(flowNode('pick', 'route_topic', 'Which one', { routes: routesFor(spokes) }, 860, 80))
  link('e-intro', 'intro', 'pick')
  link('e-pick-other', 'pick', 'intro', 'other')

  spokes.forEach((spoke, index) => {
    const y = 80 + index * 140
    if (spoke.choices && spoke.choices.length > 0) {
      nodes.push(flowNode(`ask-${spoke.handle}`, 'ask_question', spoke.title, { question: spoke.say ?? input.intro, variable: 'request' }, 1160, y))
      nodes.push(flowNode(`route-${spoke.handle}`, 'route_topic', spoke.title, { routes: routesFor(spoke.choices) }, 1460, y))
      if (openHandles.has(spoke.handle)) link(`e-open-${spoke.handle}`, 'open', `ask-${spoke.handle}`, spoke.handle)
      link(`e-pick-${spoke.handle}`, 'pick', `ask-${spoke.handle}`, spoke.handle)
      link(`e-ask-${spoke.handle}`, `ask-${spoke.handle}`, `route-${spoke.handle}`)
      link(`e-route-other-${spoke.handle}`, `route-${spoke.handle}`, 'pick', 'other')
      spoke.choices.forEach((choice, choiceIndex) => {
        const say = clip(choice.say ?? '')
        nodes.push(flowNode(`say-${choice.handle}`, 'send_message', choice.title, { text: say }, 1760, y + choiceIndex * 70))
        link(`e-choice-${choice.handle}`, `route-${spoke.handle}`, `say-${choice.handle}`, choice.handle)
        if (openHandles.has(choice.handle)) link(`e-open-choice-${choice.handle}`, 'open', `say-${choice.handle}`, choice.handle)
      })
    } else if (spoke.say) {
      nodes.push(flowNode(`say-${spoke.handle}`, 'send_message', spoke.title, { text: clip(spoke.say) }, 1460, y))
      if (openHandles.has(spoke.handle)) link(`e-open-${spoke.handle}`, 'open', `say-${spoke.handle}`, spoke.handle)
      link(`e-pick-${spoke.handle}`, 'pick', `say-${spoke.handle}`, spoke.handle)
    }
  })

  nodes.push(flowNode('clear', 'set_variable', 'Listen to the next line', { variable: 'topic', value: '-' }, 2060, 80))
  nodes.push(flowNode('again', 'ask_question', 'Continue', { question: input.again, variable: 'request' }, 2320, 80))
  link('e-clear', 'clear', 'again')
  const menus = spokes.filter((spoke) => spoke.choices && spoke.choices.length > 0)
  const follow = routesFor([...leaves, ...menus])
  if (input.bookName) follow.push({ handle: 'book', phrases: ['book', 'booking', 'appointment', 'book in'] })
  nodes.push(flowNode('again-route', 'route_topic', 'Another or book', { routes: follow }, 2580, 80))
  link('e-again', 'again', 'again-route')
  link('e-again-other', 'again-route', 'again', 'other')
  for (const leaf of leaves) link(`e-again-${leaf.handle}`, 'again-route', `say-${leaf.handle}`, leaf.handle)
  for (const menu of menus) link(`e-again-menu-${menu.handle}`, 'again-route', `ask-${menu.handle}`, menu.handle)
  for (const leaf of leaves) link(`e-say-clear-${leaf.handle}`, `say-${leaf.handle}`, 'clear')
  if (input.bookName) {
    nodes.push(flowNode('book', 'execute_flow', input.bookName, { flowName: input.bookName }, 2840, 80))
    link('e-book', 'again-route', 'book', 'book')
  }

  return {
    name: input.name,
    description: input.description,
    tags: ['website', 'faq'],
    publish: false,
    graph: { nodes, edges },
  }
}

const STOP_WORDS = new Set(['much', 'what', 'when', 'where', 'your', 'with', 'from', 'that', 'this', 'have', 'does', 'about', 'want', 'would', 'could', 'please'])

/** In-chart offer phrases may name the day so “Tuesday offer” picks that deal. Chapter listen still waits for wantsOffer. */
function phrasesForOffer(line: string): string[] {
  const day = line.match(/Every\s+(\w+)/i)?.[1]?.toLowerCase()
  const phrases = ['offer', 'offers', 'discount', 'special', 'promo']
  if (day) phrases.push(day, `every ${day}`)
  if (/%/.test(line) || /\boff\b/i.test(line)) phrases.push('percent off', 'half price')
  return uniquePhrases(phrases.filter((phrase) => !/\b(colour|color|cut|blow|wash|service)\b/i.test(phrase)))
}

function phrasesForLabel(label: string): string[] {
  const clean = label.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const phrases = clean.length >= 4 && clean !== 'cut' ? [clean] : []
  const words = clean.split(' ').filter((word) => word.length > 3 && word !== 'cut' && !STOP_WORDS.has(word))
  for (const word of words.slice(0, 3)) {
    if (!phrases.includes(word)) phrases.push(word)
  }
  if (words.length >= 2) {
    const pair = `${words[0]} ${words[1]}`
    if (pair.length >= 4 && !phrases.includes(pair)) phrases.push(pair)
  }
  return phrases.filter((phrase) => phrase !== 'book' && phrase !== 'booking' && phrase !== 'appointment')
}

function categoryPhrases(label: string): string[] {
  const text = label.toLowerCase()
  const phrases: string[] = []
  if (/\b(haircut|haircuts)\b|\bcuts?\b|cut and style|blow-?dry/.test(text)) phrases.push('haircut', 'a cut', 'cut and style')
  if (/\b(colour|color|colouring|coloring)\b/.test(text)) phrases.push('colour', 'color')
  if (/highlight|balayage|foiliage/.test(text)) phrases.push('highlights', 'balayage')
  if (/\b(treatment|treatments|filler|smoothing)\b|\bnashi\b/.test(text)) phrases.push('treatment', 'treatments')
  if (/\b(kids|children|child)\b/.test(text)) phrases.push('kids', 'children')
  if (/\b(gents?|men|male)\b/.test(text)) phrases.push('gents', 'gent', 'men', 'man')
  if (/\b(ladies|lady|women|woman)\b/.test(text)) phrases.push('ladies', 'lady', 'women', 'woman')
  return phrases
}

function uniquePhrases(phrases: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const phrase of phrases) {
    if (!phrase || seen.has(phrase) || phrase === 'cut') continue
    seen.add(phrase)
    out.push(phrase)
  }
  return out
}

function shortTitle(title: string): string {
  return title.split('/')[0]?.replace(/^A\s+/i, '').trim().toLowerCase() || title.toLowerCase()
}

function optionLabel(title: string): string {
  const cleaned = title
    .replace(/wash,?\s*cut\s*(and|&)\s*style/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const first = (cleaned || title).split(/[,/]/)[0]?.trim() || title
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/** At most three short choices. A longer menu is the next turn, or "another". */
function spokenChoices(names: string[]): string {
  const labels = names.slice(0, 3)
  if (labels.length === 0) return ''
  const more = names.length > 3
  if (labels.length === 1) return labels[0] ?? ''
  const last = labels.pop()
  const listed = `${labels.join(', ')}, or ${last}`
  return more ? `${listed} — or another` : listed
}

function whichOneLine(groupTitle: string, choices: Array<{ title: string }>): string {
  const listed = spokenChoices(choices.map((choice) => optionLabel(choice.title)))
  return listed
    ? `Which ${shortTitle(groupTitle)}? ${listed}.`
    : `Which ${shortTitle(groupTitle)}?`
}

function isNoiseLine(line: string): boolean {
  return /skip to|opens in a new tab|copyright|^©|https?:|^←/i.test(line)
}

function roleName(column: string): string {
  const clean = column.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
  if (!clean || clean.length > 24) return ''
  if (/^(service|price|prices|from|item|name|description|duration)$/.test(clean)) return ''
  return clean
}

const LABEL_COLUMN = /^(services?|treatments?|items?|name|menu)$/i

function headerRoles(line: string): string[] | null {
  if (/£/.test(line)) return null
  const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean)
  // A table head row: "Service | Creative | Senior | Stylist | Junior". Any short tier names count.
  if (cells.length >= 2 && cells.length <= 8 && LABEL_COLUMN.test(cells[0] ?? '') && !/\d/.test(line) && cells.every((cell) => cell.length <= 24)) {
    return cells.map((cell) => roleName(cell)).filter(Boolean)
  }
  const words = cells.length > 1 ? cells : line.split(/\s+/)
  if (words.length < 2 || words.length > 4 || words.some((word) => word.length > 18)) return null
  const known = new Set(['service', 'senior', 'stylist', 'price', 'prices', 'from', 'description', 'duration', 'item', 'name'])
  const cleaned = words.map((word) => word.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean)
  if (cleaned.length !== words.length || cleaned.some((word) => !known.has(word))) return null
  return words.map((word) => roleName(word)).filter(Boolean)
}

function moneyPhrase(cell: string): string | null {
  const range = cell.match(/£\s*(\d+)\s*[–—-]\s*£?\s*(\d+)/)
  if (range) return `£${range[1]} to £${range[2]}`
  const amount = cell.match(/£\s*(\d+)/)
  if (!amount) return null
  if (/\+\s*£|plus\s/i.test(cell)) return `plus £${amount[1]}`
  return /\bup to\s*£/i.test(cell) ? `up to £${amount[1]}` : `£${amount[1]}`
}

function parsePriceLine(line: string, columns: string[]): { label: string; say: string } | null {
  if (headerRoles(line) || isNoiseLine(line) || !/£\s*\d/.test(line)) return null
  if (!line.includes('|')) {
    const spoken = moneyPhrase(line)
    const label = line.replace(/£\s*\d+(?:\s*[–—-]\s*£?\s*\d+)?/g, ' ').replace(/^\s*\+\s*|\s*\+\s*$/g, '').replace(/\s+/g, ' ').trim()
    if (!spoken || label.length < 2) return null
    return { label: label.slice(0, 80), say: `${label.slice(0, 80)} is ${spoken}.` }
  }
  const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean)
  const labelParts: string[] = []
  const bits: Array<{ column: string; text: string }> = []
  for (const cell of cells) {
    const spoken = moneyPhrase(cell)
    if (!spoken) {
      const bare = cell.replace(/[—–-]/g, '').trim()
      const notOffered = bare !== cell.trim() && columns.includes(roleName(bare))
      if (bare && !notOffered && !/^(senior|stylist|price|service|n\/a)?$/i.test(bare)) labelParts.push(cell.trim())
      continue
    }
    const column = roleName(cell.replace(/£\s*\d+(?:\s*[–—-]\s*£?\s*\d+)?/g, ' ').replace(/\b(up to|from)\b/gi, ' ').replace(/[+—–-]/g, ' '))
    bits.push({ column, text: spoken })
  }
  if (bits.every((bit) => !bit.column) && columns.length >= bits.length) {
    bits.forEach((bit, index) => { bit.column = columns[index] ?? '' })
  }
  const label = labelParts.join(' ').replace(/\s+/g, ' ').trim()
  if (label.length < 2 || bits.length === 0) return null
  if (bits.length > 1 && bits.every((bit) => bit.text === bits[0]!.text)) {
    return { label: label.slice(0, 80), say: `${label} is ${bits[0]!.text}.` }
  }
  const said = bits.map((bit) => (bit.column ? `${bit.text} with a ${bit.column}` : bit.text))
  const say = said.length === 1
    ? `${label} is ${said[0]}.`
    : `${label} is ${said.join(', or ')}.`
  return { label: label.slice(0, 80), say }
}

function priceGroups(text: string): Array<{ title: string; rows: Array<{ label: string; say: string }> }> {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const groups: Array<{ title: string; rows: Array<{ label: string; say: string }> }> = []
  let pending = ''
  let columns: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const roles = headerRoles(line)
    if (roles) {
      columns = roles
      continue
    }
    const row = parsePriceLine(line, columns)
    if (!row) {
      if (line.length >= 3 && line.length <= 60 && /[a-z]/i.test(line) && !isNoiseLine(line) && !/£/.test(line)) {
        const soon = lines.slice(index + 1, index + 5).some((next) => /£\s*\d/.test(next))
        if (soon) pending = line
      }
      continue
    }
    const title = pending || 'Prices'
    let group = groups.find((item) => item.title === title)
    if (!group) {
      if (groups.length >= 6) continue
      group = { title, rows: [] }
      groups.push(group)
    }
    if (group.rows.length >= 12 || group.rows.some((existing) => existing.label === row.label)) continue
    group.rows.push(row)
  }
  return groups.filter((group) => group.rows.length > 0)
}

function spokesFromPriceGroups(groups: Array<{ title: string; rows: Array<{ label: string; say: string }> }>): Spoke[] {
  const spokes: Spoke[] = []
  for (const group of groups) {
    const choices = group.rows.map((row) => ({
      title: row.label,
      phrases: phrasesForLabel(row.label),
      say: row.say,
    })).filter((choice) => choice.phrases.length > 0 && choice.say.length > 0)
    const only = choices[0]
    if (!only) continue
    if (choices.length === 1) {
      spokes.push({
        title: group.title,
        phrases: uniquePhrases([...phrasesForLabel(group.title), ...categoryPhrases(group.title), ...only.phrases]),
        say: only.say,
      })
      continue
    }
    spokes.push({
      title: group.title,
      phrases: uniquePhrases([...phrasesForLabel(group.title), ...categoryPhrases(group.title)]),
      say: whichOneLine(group.title, choices),
      choices,
    })
  }
  return spokes
}

function sentenceSpokes(text: string): Spoke[] {
  const buckets: Array<{ title: string; phrases: string[]; pattern: RegExp }> = [
    { title: 'A cut', phrases: ['haircut', 'a cut', 'cut and style'], pattern: /\bcut\b|haircut|blow-?dry/i },
    { title: 'Colour', phrases: ['colour', 'color', 'colouring'], pattern: /colour|color/i },
    { title: 'Highlights', phrases: ['highlights', 'highlight', 'balayage', 'foiliage'], pattern: /highlight|balayage|foiliage/i },
    { title: 'A treatment', phrases: ['treatment', 'treatments', 'filler', 'smoothing'], pattern: /treatment|filler|smoothing|nashi/i },
    { title: 'Kids', phrases: ['kids', 'children'], pattern: /\bkids\b|children/i },
  ]
  const candidates: Array<{ say: string; match: string }> = []
  for (const line of text.split('\n')) {
    const parts = line.split(/(?<=\.)\s+/).map((sentence) => sentence.trim()).filter(Boolean)
    const merged: string[] = []
    for (const part of parts) {
      if (/^from\s*£\s*\d+/i.test(part) && merged.length > 0) merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.replace(/\s+/g, ' ')
      else merged.push(part)
    }
    let lead = ''
    for (const sentence of merged) {
      if (!/£\s*\d/.test(sentence)) {
        lead = sentence
        continue
      }
      candidates.push({ say: sentence, match: lead ? `${lead} ${sentence}` : sentence })
      lead = ''
    }
  }
  const used = new Set<number>()
  const spokes: Spoke[] = []
  for (const bucket of buckets) {
    const index = candidates.findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && bucket.pattern.test(candidate.match))
    const hit = index >= 0 ? candidates[index] : undefined
    if (!hit || index < 0) continue
    used.add(index)
    const spoken = bucket.pattern.test(hit.say) ? hit.say : hit.match
    spokes.push({ title: bucket.title, phrases: bucket.phrases, say: clip(spoken, 220) })
  }
  return spokes
}

function serviceSpokes(text: string): Spoke[] {
  const grouped = priceGroups(text)
  const rows = grouped.reduce((total, group) => total + group.rows.length, 0)
  if (rows >= 3) {
    const spokes = spokesFromPriceGroups(grouped)
    if (spokes.length >= 2) return spokes
  }
  return sentenceSpokes(text)
}

/** The page with the fullest price list wins, so a homepage summary does not replace the menu. */
function bestServiceSpokes(pages: ScannedPage[]): Spoke[] {
  let best: Spoke[] = []
  let bestScore = 0
  for (const page of pages) {
    const spokes = serviceSpokes(page.text)
    const score = spokes.reduce((total, spoke) => total + (spoke.choices?.length ?? 1), 0)
    if (score > bestScore) {
      best = spokes
      bestScore = score
    }
  }
  return best
}

function mentionPatch(spokes: Spoke[], patch: string | null): Spoke[] {
  if (!patch) return spokes
  return spokes.map((spoke) => {
    if (!/\bcolou?r\b/i.test(spoke.title)) return spoke
    if ((spoke.say ?? '').toLowerCase().includes('patch test')) return spoke
    return { ...spoke, say: `${patch} ${spoke.say ?? ''}`.trim() }
  })
}

function extractFaqs(text: string): Array<{ question: string; answer: string }> {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const found: Array<{ question: string; answer: string }> = []
  const questionLine = /^([A-Z][^?]{8,140}\?)$/
  for (let index = 0; index < lines.length; index += 1) {
    const question = lines[index]?.match(questionLine)?.[1]
    if (!question || found.some((item) => item.question === question)) continue
    const bits: string[] = []
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? ''
      if (questionLine.test(line)) break
      if (/^(name|email|phone|role|message|submit)$/i.test(line)) break
      if (/^©|skip to content|opens in a new tab/i.test(line)) break
      bits.push(line)
      if (bits.join(' ').length > 320) break
    }
    const answer = clip(bits.join(' '), 320)
    if (answer.length < 12) continue
    found.push({ question, answer })
  }
  return found.slice(0, 8)
}

function extractCareers(text: string): { email: string; roles: string[] } | null {
  if (!/\b(?:cv|curriculum vitae|join (?:our|the) team|careers?|vacancies)\b/i.test(text)) return null
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  if (!email) return null
  const looking = text.match(/looking for ([^.]+)/i)?.[1] ?? ''
  const roles = looking
    .split(/,|\band\b/i)
    .map((role) => role.replace(/\s+at\s+.*/i, '').replace(/\s+/g, ' ').trim())
    .filter((role) => role.length > 2 && role.length < 40 && !/\b(email|cv)\b/i.test(role))
  return { email, roles: [...new Set(roles)].slice(0, 6) }
}

function offerRank(line: string): number {
  let rank = 0
  if (/%|£/.test(line)) rank += 2
  if (line.length <= 140) rank += 1
  return rank
}

function extractOffers(text: string): string[] {
  const flat = text.replace(/\n+/g, ' ')
  const byDay = new Map<string, string>()
  const pattern = /Every\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b[^.]{0,160}(?:\.|$)/gi
  for (const match of flat.matchAll(pattern)) {
    const day = (match[1] ?? '').toLowerCase()
    const line = match[0].replace(/\s+/g, ' ').replace(/\.$/, '').trim()
    if (!day || !line) continue
    const spoken = `${line}.`
    const prev = byDay.get(day)
    if (!prev || offerRank(spoken) > offerRank(prev) || (offerRank(spoken) === offerRank(prev) && spoken.length < prev.length)) {
      byDay.set(day, spoken)
    }
  }
  return [...byDay.values()].slice(0, 6)
}

function firstSay(spoke: Spoke): string {
  if (spoke.say && !spoke.choices) return spoke.say
  return spoke.choices?.[0]?.say ?? spoke.say ?? ''
}

export function websiteChatFromLearnedSpec(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
  spec: LearnedTemplateSpec
}): WebsiteChatDraft {
  const pages = input.pages
  const company = input.companyName.trim() || 'your company'
  const persona = input.personaName?.trim() || 'the assistant'
  const spec = input.spec
  const pack = packFromLearned(spec, company, persona)
  const doors: ScanDoor[] = pack.doors.map((door) => {
    const topic = spec.topics.find((item) => item.flowName === door.flowName)
    const found = Boolean(topic && !/did not state this/i.test(topic.answer))
    return {
      title: door.title,
      flowName: door.flowName,
      blurb: door.blurb,
      answer: topic?.answer ?? door.blurb,
      found,
      phrases: topic?.phrases ?? [door.title.toLowerCase()],
    }
  })
  const facts: ScanFact[] = spec.topics
    .filter((topic) => topic.flowName !== 'Talk to a person' && !/did not state this/i.test(topic.answer))
    .slice(0, 20)
    .map((topic) => ({ label: topic.choice, text: clip(topic.answer, 180) }))
  const hours = extractHours(pages)
  if (hours && !facts.some((fact) => /hours|open/i.test(fact.label) && hoursMentionedIn(fact.text).length > 0)) facts.unshift({ label: 'Hours', text: hours })
  const first = pages[0]
  return {
    url: first?.url ?? '',
    pages: pages.map((page) => page.url),
    clusterId: spec.clusterId === 'custom' ? 'software' : spec.clusterId,
    greeting: pack.greeting,
    doors,
    facts,
    note: spec.body,
    flows: pack.flows.map((flow) => ({ ...flow, publish: false })),
    faqs: pack.faqs,
    intents: pack.intents,
    documents: pages.map((page) => ({
      title: page.title || page.url,
      url: page.url,
      content: page.text.slice(0, 20_000),
    })),
    catalog: emptyCatalog(),
    booking: null,
  }
}

function draftVendorWebsiteChat(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
  clusterId: ClusterId
}): WebsiteChatDraft {
  const company = input.companyName.trim() || 'your company'
  const identity = identityFor(input.clusterId)
  const persona = input.personaName?.trim() || identity.persona || 'the assistant'
  const spec = draftClusteredTemplate({
    pages: input.pages,
    companyName: company,
    personaName: persona,
    clusterId: input.clusterId,
    keepBrand: true,
  })
  return websiteChatFromLearnedSpec({
    pages: input.pages,
    companyName: company,
    personaName: persona,
    spec,
  })
}

/** The map, the charts, and the knowledge lines. No network. */
export function draftWebsiteChat(input: {
  pages: ScannedPage[]
  companyName: string
  personaName?: string | null
}): WebsiteChatDraft {
  const incoming = input.pages
  const pages = incoming.filter((page) => page.text.trim().length > 0)
  const cluster = suggestCluster(`${incoming.map((page) => page.text).join('\n')} ${incoming.map((page) => page.url).join(' ')}`)
  if (cluster !== 'hair') {
    return draftVendorWebsiteChat({
      pages: pages.length > 0 ? pages : incoming,
      companyName: input.companyName,
      personaName: input.personaName,
      clusterId: cluster === 'custom' ? 'software' : cluster,
    })
  }
  const text = pages.map((page) => page.text).join('\n')
  const company = companyLabel(input.companyName)
  const persona = input.personaName?.trim() || 'Bella'
  const address = extractAddress(text)
  const hours = extractHours(pages)
  const patch = extractPatch(text)
  const offers = extractOffers(text)
  const singleOffer = offers.length === 1 ? offers[0] : extractOffer(text)
  const phone = extractPhone(text)
  const booking = extractBooking(pages)
  const services = mentionPatch(bestServiceSpokes(pages), patch)
  const faqsFound = extractFaqs(text)
  const careers = extractCareers(text)
  const talks = new Map<string, { intro: string; again: string; spokes: Spoke[]; book: boolean }>()

  const locationAnswer = address
    ? `${company} is at ${address}.${phone ? ` The phone number is ${phone}.` : ''}`
    : 'The pages did not state an address.'
  const hoursAnswer = hours
    ? `${company} is open ${hours}`
    : 'The pages did not state opening hours.'
  const serviceNames = services.map((spoke) => shortTitle(spoke.title))
  const serviceIntro = serviceNames.length > 1
    ? `What are you thinking of? ${spokenChoices(serviceNames)}.`
    : serviceNames.length === 1
      ? (firstSay(services[0]!) || 'The pages did not state prices.')
      : 'The pages did not state prices.'
  const bookAnswer = booking
    ? `I'll confirm the booking in this chat and by text. You can also open it on ${namedLink(booking.label, booking.url)}.`
    : 'The pages did not show a booking link. The studio can confirm a time in this chat.'

  const core = DOORS.map((spec) => spec.flowName)
  const doors: ScanDoor[] = [
    {
      title: 'Where we are',
      flowName: 'Location',
      blurb: address ?? 'The pages did not state an address.',
      answer: locationAnswer,
      found: Boolean(address),
      phrases: DOORS[0]?.phrases ?? [],
    },
    {
      title: 'Hours',
      flowName: 'Salon hours',
      blurb: hours ?? 'The pages did not state opening hours.',
      answer: hoursAnswer,
      found: Boolean(hours),
      phrases: DOORS[1]?.phrases ?? [],
    },
    {
      title: 'Services',
      flowName: 'Services and prices',
      blurb: services.length > 1 ? serviceIntro : (firstSay(services[0] ?? { title: '', phrases: [] }) || 'The pages did not state prices.'),
      answer: services.length === 1 ? firstSay(services[0]!) : serviceIntro,
      found: services.length > 0,
      phrases: DOORS[2]?.phrases ?? [],
    },
  ]
  if (services.length > 1) {
    talks.set('Services and prices', {
      intro: serviceIntro,
      again: 'Shall we book?',
      spokes: services,
      book: true,
    })
  }

  const questionSpokes: Spoke[] = faqsFound.map((faq) => ({
    title: clip(faq.question.replace(/\?$/, ''), 42),
    phrases: phrasesForLabel(faq.question.replace(/\?$/, '')),
    say: faq.answer,
  })).filter((spoke) => spoke.phrases.length > 0)
  if (questionSpokes.length >= 2) {
    doors.push({
      title: 'Questions',
      flowName: 'Questions',
      blurb: 'Asks which question, then answers that one.',
      answer: 'What would you like to know?',
      found: true,
      phrases: ['questions', 'faq', 'frequently asked'],
    })
    talks.set('Questions', {
      intro: 'What would you like to know?',
      again: 'Shall we book?',
      spokes: questionSpokes,
      book: true,
    })
  }

  if (offers.length >= 2) {
    doors.push({
      title: 'Offers',
      flowName: 'Offers',
      blurb: 'Asks which offer, then says that one.',
      answer: 'Which offer are you asking about?',
      found: true,
      phrases: ['offer', 'offers', 'discount', 'special offer'],
    })
    talks.set('Offers', {
      intro: 'Which offer are you asking about?',
      again: 'Shall we book?',
      spokes: offers.map((line) => ({
        title: line.match(/Every\s+(\w+)/i)?.[1] ?? 'Offer',
        phrases: phrasesForOffer(line),
        say: line,
      })),
      book: true,
    })
  }

  if (careers) {
    const roleSpokes: Spoke[] = careers.roles.map((role) => ({
      title: role.charAt(0).toUpperCase() + role.slice(1),
      phrases: phrasesForLabel(role),
      say: `Email your CV to ${careers.email}. We are looking for ${role}.`,
    }))
    const careerAnswer = roleSpokes.length > 1
      ? 'Which role are you asking about?'
      : `Email your CV to ${careers.email}.`
    doors.push({
      title: 'Join the team',
      flowName: 'Join the team',
      blurb: careerAnswer,
      answer: careerAnswer,
      found: true,
      phrases: ['cv', 'curriculum vitae', 'join the team', 'career', 'vacancy'],
    })
    if (roleSpokes.length > 1) {
      talks.set('Join the team', {
        intro: 'Which role are you asking about?',
        again: 'Want another role? I can also leave it there.',
        spokes: roleSpokes,
        book: false,
      })
    }
  }

  doors.push({
    title: 'Book',
    flowName: 'Book an appointment',
    blurb: booking ? `Workflow · ${booking.label}. Confirmed in chat, then ${booking.label}.` : 'The pages did not show a booking link.',
    answer: bookAnswer,
    found: Boolean(booking),
    phrases: DOORS[3]?.phrases ?? [],
  })

  const facts: ScanFact[] = []
  if (address) facts.push({ label: 'Contact', text: phone ? `${address}. ${phone}` : address })
  if (hours) facts.push({ label: 'Hours', text: hours })
  let serviceFacts = 0
  for (const spoke of services) {
    const lines = spoke.choices && spoke.choices.length > 0 ? spoke.choices : [spoke]
    for (const line of lines) {
      if (!line.say || serviceFacts >= 20) continue
      facts.push({ label: spoke.title, text: clip(line.say, 180) })
      serviceFacts += 1
    }
  }
  if (patch) facts.push({ label: 'Colour', text: patch })
  if (offers.length >= 2) {
    for (const line of offers) facts.push({ label: 'Offers', text: line })
  } else if (singleOffer) facts.push({ label: 'Offers', text: singleOffer })
  if (careers) facts.push({ label: 'Careers', text: `Email a CV to ${careers.email}.` })
  const pageNames = pages.slice(1).map((page) => {
    try {
      return (new URL(page.url).pathname.split('/').filter(Boolean).pop() ?? '')
        .replace(/\.html?$/i, '')
        .replace(/-/g, ' ')
    } catch {
      return ''
    }
  }).filter(Boolean)
  if (pageNames.length > 0) facts.push({ label: 'Pages', text: pageNames.join(', ') })
  facts.push({ label: 'Site', text: 'Terms and the full pages stay in Knowledge.' })

  const cancel = /[^.!?\n]{0,40}\bcancel(?:lation|led)?\b[^.!?\n]*[.!?]/i.exec(text.replace(/\n+/g, ' '))
  const note = cancel
    ? ''
    : 'Left off the map. The pages do not state a cancellation rule.'
  if (cancel?.[0]) facts.splice(facts.length - 1, 0, { label: 'Policy', text: cancel[0].replace(/\s+/g, ' ').trim() })

  const catalog = catalogFromScan({
    locationAnswer,
    hoursAnswer,
    address,
    hours,
    services,
    offers: offers.length >= 2 ? offers : (singleOffer ? [singleOffer] : []),
    patch,
    cancel: cancel?.[0] ? cancel[0].replace(/\s+/g, ' ').trim() : null,
    careers,
  })

  const greeting = `${introLine(persona, company)} What's your name?`
  const flows = [
    welcomeFlow(company, persona, doors),
    ...doors.map((door) => {
      const talk = talks.get(door.flowName)
      if (talk) {
        return conversationFlow({
          name: door.flowName,
          description: 'Asks one thing at a time, from the public website.',
          intro: talk.intro,
          again: talk.again,
          spokes: talk.spokes,
          bookName: talk.book ? 'Book an appointment' : null,
        })
      }
      if (door.flowName === 'Location' && address) {
        return lookupDoor('Location', 'location', 'Are you after the address?', 'Want the hours?')
      }
      if (door.flowName === 'Salon hours' && hours) {
        return lookupDoor('Salon hours', 'hours', 'Are you after the opening hours?', 'Shall I book a time?')
      }
      if (door.flowName === 'Book an appointment') {
        return bookAppointmentFlow({
          publish: false,
          tags: ['website', 'booking'],
          description: booking
            ? `Qualifies a colour or cut, then confirms in chat and by text. ${booking.label} is the diary workflow.`
            : 'Qualifies a colour or cut, then confirms in chat and by text.',
          booking,
          timeQuestion: 'When would suit you?',
        })
      }
      return answerFlow(door.flowName, door.answer)
    }),
  ]
  const faqs = DOORS.filter((spec) => core.includes(spec.flowName)).map((spec) => {
    const door = doors.find((item) => item.flowName === spec.flowName)
    return {
      question: spec.question,
      answer: door?.answer ?? '',
      tags: ['website', handleFor(spec.flowName)],
    }
  }).filter((faq) => faq.answer.length > 0)
  for (const faq of faqsFound) faqs.push({ question: faq.question, answer: faq.answer, tags: ['website', 'questions'] })
  if (patch) faqs.push({ question: 'Do I need a patch test?', answer: patch, tags: ['website', 'patch-test'] })
  if (singleOffer) faqs.push({ question: 'What offers do you have?', answer: singleOffer, tags: ['website', 'offers'] })

  const intents = doors.map((door) => ({
    name: door.flowName,
    description: door.blurb,
    utterances: door.phrases,
    responses: [{ text: door.answer }],
  }))

  const first = pages[0]
  return {
    url: first?.url ?? '',
    pages: pages.map((page) => page.url),
    clusterId: 'hair',
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
    catalog,
    booking,
  }
}

function catalogFromScan(input: {
  locationAnswer: string
  hoursAnswer: string
  address: string | null
  hours: string | null
  services: Spoke[]
  offers: string[]
  patch: string | null
  cancel: string | null
  careers: { email: string; roles: string[] } | null
}): StudioCatalog {
  const facts: CatalogFact[] = []
  const used = new Set<string>()
  if (input.address) {
    facts.push({
      id: 'location',
      kind: 'studio',
      title: 'Location',
      phrases: DOORS[0]?.phrases ?? ['address'],
      fact: input.locationAnswer,
      source: 'Location',
    })
    used.add('location')
  }
  if (input.hours) {
    facts.push({
      id: 'hours',
      kind: 'studio',
      title: 'Hours',
      phrases: DOORS[1]?.phrases ?? ['hours'],
      fact: input.hoursAnswer,
      source: 'Salon hours',
    })
    used.add('hours')
  }
  for (const spoke of input.services) {
    const lines = spoke.choices && spoke.choices.length > 0 ? spoke.choices : [spoke]
    for (const line of lines) {
      if (!line.say) continue
      const id = slugHandle(line.title, used)
      facts.push({
        id,
        kind: 'service',
        title: line.title,
        phrases: uniquePhrases([...line.phrases, ...phrasesForLabel(line.title)]),
        fact: line.say,
        source: 'Services and prices',
      })
    }
  }
  if (input.patch) {
    facts.push({
      id: slugHandle('patch-test', used),
      kind: 'policy',
      title: 'Patch test',
      phrases: ['patch test', 'allergy test'],
      fact: input.patch,
      source: 'Services and prices',
    })
  }
  for (const line of input.offers) {
    facts.push({
      id: slugHandle(line.match(/Every\s+(\w+)/i)?.[1] ?? 'offer', used),
      kind: 'offer',
      title: 'Offer',
      phrases: phrasesForOffer(line),
      fact: line,
      source: 'Offers',
    })
  }
  if (input.cancel) {
    facts.push({
      id: slugHandle('cancellation', used),
      kind: 'policy',
      title: 'Cancellation',
      phrases: ['cancel', 'cancellation'],
      fact: input.cancel,
      source: 'Cancellation policy',
    })
  }
  if (input.careers) {
    facts.push({
      id: slugHandle('careers', used),
      kind: 'policy',
      title: 'Join the team',
      phrases: ['cv', 'career', 'vacancy', 'join the team'],
      fact: `Email a CV to ${input.careers.email}.`,
      source: 'Join the team',
    })
  }
  return facts.length > 0 ? { facts } : emptyCatalog()
}
