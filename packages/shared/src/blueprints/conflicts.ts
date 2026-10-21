/**
 * Knowledge that disagrees with Business details.
 *
 * Business details win at answer time, but an old page that still says "open
 * until 8pm" is worth fixing: it shows up as a source in the Inbox and confuses
 * people reading it. This finds hours, phone numbers and prices in other
 * Knowledge documents that differ from the confirmed details. Rule-based, no model.
 */

import {
  formatPrice,
  formatWeeklyHours,
  isEmptyValue,
  type BlueprintFieldSpec,
  type BusinessProfile,
  type OpeningDay,
  type PriceItem,
} from './business.js'
import { formatUkPhone, hoursMentionedIn, phoneDigits, phoneNumbersIn } from './extract.js'

export interface KnowledgeText {
  documentId: string
  title: string
  /** The source's name, e.g. "harbourdental.co.uk". */
  source: string
  sourceKind: string
  text: string
}

export interface KnowledgeConflict {
  field: string
  label: string
  documentId: string
  documentTitle: string
  source: string
  /** What the document says, quoted. */
  says: string
  /** What Business details say. */
  expected: string
  message: string
}

const MAX_CONFLICTS = 20
const CALLED = /call|phone|tel\b|tel:|ring|contact|reception/i
/** A price straight after the item's name: "Check-up: £45", "Check-up | from £45". Any other word in between and it is someone else's price. */
const PRICE_AFTER_NAME = /^[\s:|,.\-–—()]*(?:(?:from|only|just|costs?|is|at|now)\s+)*£\s?(\d[\d,]*(?:\.\d{1,2})?)/

function sameDay(a: OpeningDay, b: OpeningDay): boolean {
  if (a.closed || b.closed) return Boolean(a.closed) === Boolean(b.closed)
  return a.open === b.open && a.close === b.close
}

function hoursConflicts(text: string, hours: OpeningDay[]): Array<{ says: string; expected: string }> {
  const byDay = new Map(hours.map((row) => [row.day, row]))
  const found: Array<{ says: string; expected: string }> = []
  for (const mention of hoursMentionedIn(text)) {
    const differing = mention.hours.filter((row) => {
      const confirmed = byDay.get(row.day)
      return confirmed && !sameDay(confirmed, row)
    })
    if (differing.length === 0) continue
    found.push({ says: mention.quote, expected: formatWeeklyHours(differing.map((row) => byDay.get(row.day)!)).replace(/\.$/, '') })
  }
  return found
}

function phoneConflicts(text: string, phone: string): Array<{ says: string; expected: string }> {
  const expected = phoneDigits(phone)
  if (!expected) return []
  const numbers = phoneNumbersIn(text)
  if (numbers.some((item) => item.digits === expected)) return []
  return numbers
    .filter((item) => CALLED.test(item.context))
    .map((item) => ({ says: formatUkPhone(item.digits), expected: formatUkPhone(expected) }))
}

function flat(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ')
}

/** "Check-up" inside "Check-up and hygiene together" belongs to the longer item. */
function insideLongerName(hay: string, at: number, name: string, names: string[]): boolean {
  return names.some((other) => {
    if (other === name || !other.includes(name)) return false
    const offset = other.indexOf(name)
    return hay.slice(at - offset, at - offset + other.length) === other
  })
}

function priceConflicts(text: string, items: PriceItem[]): Array<{ says: string; expected: string }> {
  const hay = flat(text)
  const names = items.map((item) => flat(item.name).trim())
  const found: Array<{ says: string; expected: string }> = []
  for (const item of items) {
    const name = flat(item.name).trim()
    if (name.length < 6) continue
    let at = hay.indexOf(name)
    while (at >= 0) {
      const after = hay.slice(at + name.length, at + name.length + 40)
      const match = insideLongerName(hay, at, name, names) ? null : after.match(PRICE_AFTER_NAME)
      if (match) {
        const amount = Number(match[1]!.replace(/,/g, ''))
        if (Number.isFinite(amount) && Math.abs(amount - item.amount) > 0.005) {
          found.push({ says: `${item.name} £${match[1]}`, expected: `${item.name} ${formatPrice(item)}` })
          break
        }
      }
      at = hay.indexOf(name, at + name.length)
    }
  }
  return found
}

/** Each disagreement once per document and field, Business details documents skipped. */
export function knowledgeConflicts(specs: BlueprintFieldSpec[], profile: BusinessProfile, documents: KnowledgeText[]): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = []
  const seen = new Set<string>()
  for (const doc of documents) {
    if (doc.sourceKind === 'business') continue
    for (const spec of specs) {
      const value = profile.fields[spec.key]?.value
      if (isEmptyValue(value)) continue
      const found = spec.kind === 'weekly_hours' ? hoursConflicts(doc.text, value as OpeningDay[])
        : spec.kind === 'phone' ? phoneConflicts(doc.text, String(value))
          : spec.kind === 'price_list' ? priceConflicts(doc.text, value as PriceItem[])
            : []
      for (const item of found) {
        const key = `${doc.documentId}|${spec.key}|${item.says.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        conflicts.push({
          field: spec.key,
          label: spec.label,
          documentId: doc.documentId,
          documentTitle: doc.title,
          source: doc.source,
          says: item.says,
          expected: item.expected,
          message: `${doc.source}, "${doc.title}", says "${item.says}", but ${spec.label} in Business details says ${item.expected}. Answers use Business details. Update or remove the old text so they agree.`,
        })
        if (conflicts.length >= MAX_CONFLICTS) return conflicts
      }
    }
  }
  return conflicts
}
