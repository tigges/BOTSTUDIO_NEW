/**
 * Reads typed business details from scanned pages without a model.
 * Each reader returns the value, the page it came from, and a note when the
 * site disagrees with itself (two different opening hours, for example).
 */

import type { ScannedPage } from '../website-scan.js'
import { pickWeek } from '../opening-hours.js'
import { WEEKDAYS, WEEKDAY_NAMES, formatWeeklyHours, type BusinessField, type OpeningDay, type PlanItem, type PriceItem, type TopicItem } from './business.js'

export interface VocabularyTerm {
  name: string
  /** Words that mean this item on a page and in a guest's message. */
  terms: string[]
  /** Which price row a guest means by these words when several match, e.g. the existing-patient exam for "check-up". */
  prefer?: RegExp
}

function linesOf(page: ScannedPage): string[] {
  return page.text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function sourceOf(page: ScannedPage): BusinessField['source'] {
  return { url: page.url, ...(page.title ? { title: page.title } : {}) }
}

function found(value: BusinessField['value'], page: ScannedPage | undefined, extra: Partial<BusinessField> = {}): BusinessField {
  return { value, status: 'found', ...(page ? { source: sourceOf(page) } : {}), ...extra }
}

const MISSING: BusinessField = { value: null, status: 'missing' }

function pathOf(page: ScannedPage): string {
  try { return new URL(page.url).pathname.toLowerCase() } catch { return page.url.toLowerCase() }
}

/** Pages whose address says what they hold come first, then the rest in scan order. */
function ranked(pages: ScannedPage[], hint: RegExp): ScannedPage[] {
  return [...pages.filter((page) => hint.test(pathOf(page)) || hint.test(page.title)), ...pages.filter((page) => !(hint.test(pathOf(page)) || hint.test(page.title)))]
}

// ── Phone ────────────────────────────────────────────────────────────────────

const PHONE = /(?:\+44\s*\(?0?\)?\s*|\(?0)\d[\d\s()-]{7,14}\d/g

function nationalDigits(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('44')) digits = digits.slice(2)
  if (digits.startsWith('0') === false) digits = `0${digits}`
  digits = digits.replace(/^00/, '0')
  return digits.length === 11 ? digits : null
}

export function formatUkPhone(digits: string): string {
  if (/^02/.test(digits)) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`
  if (/^01\d1|^011/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}

/** UK numbers in free text as 11 national digits, each with the words in front of it in the same sentence. */
export function phoneNumbersIn(text: string): Array<{ digits: string; context: string }> {
  return [...text.matchAll(PHONE)].flatMap((match) => {
    const digits = nationalDigits(match[0])
    if (!digits) return []
    const at = match.index ?? 0
    const before = text.slice(Math.max(0, at - 40), at).split(/[.!?\n]\s/).pop() ?? ''
    return [{ digits, context: `${before}${match[0]}` }]
  })
}

export function phoneDigits(raw: string): string | null {
  return nationalDigits(raw)
}

/** The number the site repeats most; a number next to "call" or "phone" breaks a tie. */
export function readPhone(pages: ScannedPage[]): BusinessField {
  const counts = new Map<string, { count: number; page: ScannedPage; called: boolean }>()
  for (const page of pages) {
    for (const line of linesOf(page)) {
      for (const match of line.matchAll(PHONE)) {
        const digits = nationalDigits(match[0])
        if (!digits) continue
        const row = counts.get(digits) ?? { count: 0, page, called: false }
        row.count += 1
        if (/call|phone|tel/i.test(line)) row.called = true
        counts.set(digits, row)
      }
    }
  }
  const best = [...counts.entries()].sort((a, b) => Number(b[1].called) - Number(a[1].called) || b[1].count - a[1].count)[0]
  return best ? found(formatUkPhone(best[0]), best[1].page) : MISSING
}

// ── Address ──────────────────────────────────────────────────────────────────

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i

function tidyAddress(line: string): string {
  return line
    .replace(POSTCODE, (_, out: string, inward: string) => `${out.toUpperCase()} ${inward.toUpperCase()}`)
    .replace(/\b([A-Z]{3,})\b/g, (word) => word.charAt(0) + word.slice(1).toLowerCase())
    .replace(/\s*,\s*/g, ', ')
    .trim()
}

/** A line with a UK postcode. Lines with commas read better, so they win a tie. */
export function readAddress(pages: ScannedPage[]): BusinessField {
  // The same address is often written twice (a punctuated header, a bare footer); count them as one.
  const counts = new Map<string, { count: number; text: string; page: ScannedPage }>()
  for (const page of pages) {
    const lines = linesOf(page)
    lines.forEach((line, index) => {
      if (!POSTCODE.test(line) || line.length > 140 || /£|\d{4,}\s*$/.test(line)) return
      let candidate = line
      if (line.length < 24) {
        const before = lines.slice(Math.max(0, index - 3), index).filter((item) => item.length < 50 && !/address|contact|phone|email/i.test(item))
        candidate = [...before, line].join(', ')
      }
      if (!/\d/.test(candidate.replace(POSTCODE, ''))) return
      const text = tidyAddress(candidate)
      const key = text.toLowerCase().replace(/[^a-z0-9]/g, '')
      const row = counts.get(key) ?? { count: 0, text, page }
      row.count += text.includes(',') ? 2 : 1
      if (commas(text) > commas(row.text)) Object.assign(row, { text, page })
      counts.set(key, row)
    })
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0]
  return best ? found(best.text, best.page) : MISSING
}

function commas(text: string): number {
  return text.split(',').length - 1
}

// ── Opening hours ────────────────────────────────────────────────────────────

export { hoursFromLine, hoursMentionedIn } from '../opening-hours.js'

/** Every week of day lines on every page. The most repeated week wins; a different week is a conflict to check. */
export function readHours(pages: ScannedPage[]): BusinessField {
  const picked = pickWeek(pages)
  if (!picked) return MISSING
  const { best, other } = picked
  if (!other) return found(best.hours, best.page)
  const differing = WEEKDAYS.filter((day) => {
    const a = best.hours.find((row) => row.day === day)
    const b = other.hours.find((row) => row.day === day)
    return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
  })
  const say = (hours: OpeningDay[]) => differing
    .map((day) => {
      const row = hours.find((item) => item.day === day)
      return row ? formatWeeklyHours([row]).replace(/\.$/, '') : `${WEEKDAY_NAMES[day]} not listed`
    })
    .join('; ')
  const where = pathOf(other.page) === '/' ? 'the home page' : `the ${pathOf(other.page)} page`
  return found(best.hours, best.page, {
    status: 'conflict',
    alternative: other.hours,
    note: `The website disagrees with itself: most pages say ${say(best.hours)}, but ${where} says ${say(other.hours)}. Pick the right one.`,
  })
}

// ── Prices ───────────────────────────────────────────────────────────────────

const PRICE_LINE = /^(.*?)\s*\|?\s*(per unit\s+)?(from\s+)?£\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\+|\|)?\s*\|?\s*$/i

function hasTerm(text: string, vocabulary: VocabularyTerm[]): boolean {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  return vocabulary.some((item) => item.terms.some((term) => {
    const needle = term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return needle.length >= 3 && (hay.includes(` ${needle} `) || hay.includes(` ${needle}s `))
  }))
}

function isHeading(line: string): boolean {
  return line.length <= 48 && !/[.£:?!|]/.test(line) && /[a-z]/i.test(line) && line.split(' ').length <= 6
}

/**
 * Rows like "Small | From £120 |" under a heading like "Composite fillings".
 * A row whose own name names no treatment takes the heading in front: "Composite fillings, small".
 */
export function readPrices(pages: ScannedPage[], vocabulary: VocabularyTerm[]): BusinessField {
  let best: { items: PriceItem[]; page: ScannedPage } | undefined
  for (const page of ranked(pages, /fee|price|pricing|cost/)) {
    const items: PriceItem[] = []
    let heading = ''
    let previousHeading = ''
    for (const line of linesOf(page)) {
      const match = line.match(PRICE_LINE)
      if (!match) {
        if (isHeading(line)) {
          previousHeading = heading
          heading = line
        }
        continue
      }
      let name = (match[1] ?? '').replace(/[|:–-]+$/, '').trim()
      let group = heading
      if (/^\(/.test(name) && heading) {
        name = `${heading} ${name.toLowerCase()}`
        group = previousHeading
      }
      if (!name || name.length > 70 || /per month|\/month|a month/i.test(line) || /%|\bover\b|\bunder\b|\bstarting\b|\bjust\b/i.test(name)) continue
      const amount = Number((match[4] ?? '').replace(/,/g, ''))
      if (!Number.isFinite(amount) || amount <= 0) continue
      const named = group && !hasTerm(name, vocabulary) && hasTerm(group, vocabulary)
        ? `${group}, ${name.charAt(0).toLowerCase()}${name.slice(1)}`
        : name
      items.push({ name: named, amount, ...(match[3] || match[2] ? { from: true } : {}), ...(group ? { group } : {}) })
    }
    if (items.length >= 4 && (!best || items.length > best.items.length)) best = { items, page }
  }
  return best ? found(best.items, best.page) : MISSING
}

// ── Plans ────────────────────────────────────────────────────────────────────

const MONTHLY = /^£\s?(\d+(?:\.\d{1,2})?)\s*(?:\/\s*month|per month|a month|pm)?$/i

/** "Core Care Plan" / "£9.90" / "per month" / benefits… until the next plan or a long line. */
export function readPlans(pages: ScannedPage[]): BusinessField {
  for (const page of ranked(pages, /plan|fee|price|membership/)) {
    const lines = linesOf(page)
    const plans: PlanItem[] = []
    for (let i = 0; i < lines.length; i++) {
      const name = lines[i]!
      if (!/plan|membership|club/i.test(name) || name.length > 40 || /[.£]/.test(name)) continue
      const priceLine = lines.slice(i + 1, i + 3).find((line) => MONTHLY.test(line))
      if (!priceLine) continue
      const next = lines[i + 1] ?? ''
      if (next !== priceLine && /plan|membership|club/i.test(next) && next.length <= 40 && !/[.£]/.test(next)) continue
      const monthly = Number(priceLine.match(MONTHLY)![1])
      const includes: string[] = []
      let j = lines.indexOf(priceLine, i) + 1
      for (; j < lines.length && includes.length < 12; j++) {
        const line = lines[j]!
        if (/^per month$|^a month$|^benefits/i.test(line)) continue
        const nextIsPlan = /plan|membership/i.test(line) && line.length <= 40 && lines.slice(j + 1, j + 3).some((item) => MONTHLY.test(item))
        if (nextIsPlan || line.length > 80 || /^(contact|book your|book now|sign up|join now)/i.test(line)) break
        includes.push(line)
      }
      plans.push({ name, monthly, includes })
      i = j - 1
    }
    if (plans.length >= 1) return found(plans, page)
  }
  return MISSING
}

// ── Sentences near a word ────────────────────────────────────────────────────

/** "Payment Plans & Financing" is a heading, not an answer. A line with a number in it still counts. */
function isTitle(line: string): boolean {
  if (/\d|[.!?]$/.test(line)) return false
  const words = line.split(/\s+/).filter((word) => /[a-z]/i.test(word))
  return words.length > 0 && words.length <= 6 && words.every((word) => /^[A-Z&]/.test(word) || /^(and|or|of|the|to|for|with|on|in|a)$/.test(word))
}

function firstSentences(line: string, max: number): string {
  const sentences = line.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [line]
  let out = ''
  for (const sentence of sentences) {
    if ((out + sentence).trim().length > max) break
    out += sentence
  }
  return (out || line.slice(0, max)).trim()
}

/** Lines that match, near each other on the best page, joined into a short paragraph. */
function readLines(pages: ScannedPage[], hint: RegExp, test: RegExp, options: { max?: number; min?: number; lines?: number } = {}): BusinessField {
  const min = options.min ?? 20
  for (const page of ranked(pages, hint)) {
    const picked: string[] = []
    for (const line of linesOf(page)) {
      if (line.length < min || line.length > 400 || !test.test(line)) continue
      if (isTitle(line)) continue
      if (picked.includes(line)) continue
      picked.push(firstSentences(line, 240))
      if (picked.length >= (options.lines ?? 3)) break
    }
    if (picked.length) {
      const text = picked.map((line) => /[.!?]$/.test(line) ? line : `${line}.`).join(' ')
      return found(text.slice(0, options.max ?? 600), page)
    }
  }
  return MISSING
}

export function readFinance(pages: ScannedPage[]): BusinessField {
  return readLines(pages, /fee|price|finance|payment/, /0%|interest[- ]free|financ|spread the cost|monthly payment/i, { min: 15, lines: 2 })
}

export function readEmergency(pages: ScannedPage[]): BusinessField {
  return readLines(pages, /contact|emergenc/, /emergenc/i, { min: 40, lines: 2 })
}

export function readDirections(pages: ScannedPage[]): BusinessField {
  return readLines(pages, /contact|find|location|direction/, /park|station|bus|tube|train|walk from|car park/i, { min: 25, lines: 4, max: 700 })
}

export function readCancellation(pages: ScannedPage[]): BusinessField {
  return readLines(pages, /terms|polic|cancel|contact/, /cancel.*(notice|hours|charge|fee)|(notice|hours).*cancel/i, { min: 30, lines: 1 })
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** A numbered list such as "1. Warm Welcome : …", plus a line about forms to fill in before the visit. */
export function readSteps(pages: ScannedPage[], hint: RegExp): BusinessField {
  for (const page of ranked(pages, hint)) {
    if (!hint.test(pathOf(page)) && !hint.test(page.title)) continue
    const lines = linesOf(page)
    const steps: string[] = []
    for (const line of lines) {
      const match = line.match(/^\d{1,2}[.)]\s+(.+)$/)
      if (!match) continue
      const [head, ...rest] = match[1]!.split(/\s*:\s*/)
      const body = rest.join(': ')
      const step = body ? `${head!.trim()}: ${firstSentences(body, 160)}` : firstSentences(head!, 180)
      steps.push(step.replace(/\s*:\s*$/, '').replace(/,?\s*including$/i, ''))
    }
    const forms = lines.find((line) => /medical history|form/i.test(line) && line.length > 40 && line.length < 400)
    if (forms) steps.push(firstSentences(forms, 200))
    if (steps.length >= 2) return found(steps.slice(0, 8), page)
  }
  return MISSING
}

// ── Booking link ─────────────────────────────────────────────────────────────

const BOOKING_HOST = /portal|dentally|book|appointment|calendly|setmore|pearl|soe|onlinebooking|fresha/i
const SOCIAL_HOST = /facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|google|whatsapp/i

/** An online booking system on another site beats the practice's own booking page. */
export function readBookingLink(pages: ScannedPage[]): BusinessField {
  let own: { url: string; page: ScannedPage } | undefined
  for (const page of ranked(pages, /book|appointment/)) {
    let origin = ''
    try { origin = new URL(page.url).origin } catch { origin = '' }
    for (const link of page.links ?? []) {
      let url: URL
      try { url = new URL(link.href, page.url) } catch { continue }
      if (!/^https?:$/.test(url.protocol)) continue
      const external = url.origin !== origin
      if (external && BOOKING_HOST.test(url.hostname) && !SOCIAL_HOST.test(url.hostname)) return found(`${url.origin}/`, page)
      if (!external && !own && /book/i.test(url.pathname)) own = { url: url.href, page }
    }
  }
  return own ? found(own.url, own.page) : MISSING
}

// ── Topics ───────────────────────────────────────────────────────────────────

/** Statements only: a page often opens with a teaser question ("Dreaming of a whiter smile?"). */
function summaryOf(line: string, max: number): string {
  const sentences = (line.replace(/^\d{1,2}[.)]\s*/, '').match(/[^.!?]+[.!?]+(\s|$)/g) ?? [line]).map((item) => item.trim())
  const statements = sentences.filter((item) => !item.endsWith('?'))
  let out = ''
  for (const item of statements) {
    if (`${out} ${item}`.trim().length > max) break
    out = `${out} ${item}`.trim()
  }
  return out
}

/**
 * For every vocabulary item, the paragraph that is about it: right under a heading
 * that names it, or naming it early, and not a paragraph that lists several others.
 */
export function readTopics(pages: ScannedPage[], vocabulary: VocabularyTerm[]): BusinessField {
  const topics: TopicItem[] = []
  let first: ScannedPage | undefined
  const content = pages.filter((page) => !/fee|price|contact|team|blog|privacy|terms|new[-_ ]?patient/.test(pathOf(page)))
    .sort((a, b) => Number(pathOf(a) === '/') - Number(pathOf(b) === '/'))
  for (const item of vocabulary) {
    let best: { summary: string; score: number; page: ScannedPage } | undefined
    for (const page of content) {
      const lines = linesOf(page)
      lines.forEach((line, index) => {
        if (line.length < 80 || line.length > 1500 || !hasTerm(line, [item])) return
        const summary = summaryOf(line, 260)
        if (summary.length < 50) return
        const others = vocabulary.filter((other) => other !== item && hasTerm(line, [other])).length
        const heading = lines.slice(Math.max(0, index - 2), index).some((above) => above.length <= 140 && hasTerm(above, [item]))
        const score = (heading ? 3 : 0) + (hasTerm(line.slice(0, 90), [item]) ? 2 : 0) + (pathOf(page) === '/' ? -1 : 0) - others - (/^(yes|no)\b/i.test(summary) ? 3 : 0)
        if (!best || score > best.score) best = { summary, score, page }
      })
    }
    // A line that only lists treatments in passing ("from check-ups to implants") scores 0 and is not an explanation.
    if (!best || best.score < 1) continue
    topics.push({ name: item.name, summary: best.summary, phrases: item.terms })
    first ??= best.page
  }
  return topics.length ? found(topics, first) : MISSING
}

/** "The Ealing Dental Practice — Ealing & Hanwell" is "The Ealing Dental Practice". */
export function readBusinessName(pages: ScannedPage[]): string {
  const title = pages[0]?.title ?? ''
  return title.split(/\s+[—–|-]\s+|\s*\|\s*/)[0]?.trim() ?? ''
}
