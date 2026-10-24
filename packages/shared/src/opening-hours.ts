/**
 * Opening hours in the many ways websites write them, read into one typed week.
 *
 * "Monday : 8 am - 6 pm", "Mon–Fri 9:00–17:30", "Tuesday to Thursday 8.30am until 5pm",
 * "Weekdays 9am-5pm", "Sat & Sun closed", "Open 7 days 10am - 4pm", "Monday | 9am – 1pm, 2pm – 5pm",
 * "Open 9am to 5pm, Monday to Friday", "12 noon", "a.m./p.m.".
 */

import { WEEKDAYS, WEEKDAY_NAMES, type OpeningDay, type Weekday } from './blueprints/business.js'

const DAY_WORD = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\\.?'
const DAY_SET = '(?:weekdays|week\\s*days|weekends?|daily|every\\s*day|(?:7|seven)\\s*days(?:\\s*a\\s*week)?)'
const DAY_TO = '(?:-|–|—|to|through|thru|until|till)'
const DAY_AND = '(?:,|&|and|\\+|/)'
const DAY_ITEM = `(?:${DAY_WORD}(?:\\s*${DAY_TO}\\s*${DAY_WORD})?|${DAY_SET})`
const DAY_LIST = `${DAY_ITEM}(?:\\s*${DAY_AND}\\s*${DAY_ITEM})*`
const TIME = '(?:(?:12\\s*)?(?:noon|midday)|midnight|\\d{1,2}(?:[:.]\\d{2})?\\s*(?:[ap]\\.?\\s?m\\.?(?![a-z]))?)'
const TIME_TO = '\\s*(?:-|–|—|to|until|till|\'?til)\\s*'
const TIME_RANGE = `${TIME}${TIME_TO}${TIME}`
const TIMES = `${TIME_RANGE}(?:\\s*(?:,|&|and|/)\\s*${TIME_RANGE})?`
/** What sits between the days and the times: "Monday : ", "Mon | ", "Monday – ", "Weekdays we're open from ". */
const GAP = `[\\s:|,–—-]*(?:(?:we(?:'re|\\s+are)\\s+)?(?:open|from|hours)\\b[\\s:]*)*`

const DAYS_FIRST = new RegExp(`(?<![a-z])(${DAY_LIST})${GAP}(?:(${TIMES})|(closed)\\b)`, 'gi')
const TIMES_FIRST = new RegExp(`(?<![a-z\\d:.])(${TIMES})\\s*[,:]?\\s*(?:on\\s+|every\\s+)?(${DAY_LIST})(?![a-z])`, 'gi')
const ONE_RANGE = new RegExp(`(${TIME})${TIME_TO}(${TIME})`, 'gi')

/** A heading or phrase that says hours follow: "Opening hours", "Working Hours", "Surgery times", "We are open". */
export const HOURS_HEADING = /\b(?:(?:opening|working|surgery|practice|clinic|office|business|studio|salon|shop|store|reception|trading|our)\s+(?:hours|times)|open(?:ing)?\s+times|hours\s+of\s+(?:business|operation)|we(?:'re|\s+are)\s+open|when\s+(?:we're|we\s+are)\s+open|hours\s*:|open)\b/i

export interface HoursMention {
  hours: OpeningDay[]
  /** The words on the page, as written. */
  quote: string
  index: number
}

function dayOf(word: string): Weekday | undefined {
  const key = word.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3)
  return WEEKDAYS.find((day) => day === key)
}

function daySet(word: string): Weekday[] {
  const text = word.toLowerCase()
  if (/^week\s*days$/.test(text)) return ['mon', 'tue', 'wed', 'thu', 'fri']
  if (/^weekends?$/.test(text)) return ['sat', 'sun']
  return [...WEEKDAYS]
}

/** "Mon–Wed, Fri & Sat" is five days; "Fri - Mon" runs over the weekend. */
export function daysIn(text: string): Weekday[] {
  const out: Weekday[] = []
  const add = (days: Weekday[]) => days.forEach((day) => { if (!out.includes(day)) out.push(day) })
  const items = text.match(new RegExp(DAY_ITEM, 'gi')) ?? []
  for (const item of items) {
    if (new RegExp(`^${DAY_SET}$`, 'i').test(item.trim())) { add(daySet(item.trim())); continue }
    const ends = item.match(new RegExp(DAY_WORD, 'gi')) ?? []
    const first = dayOf(ends[0] ?? '')
    const last = dayOf(ends[ends.length - 1] ?? '')
    if (!first || !last) continue
    const from = WEEKDAYS.indexOf(first)
    const span = (WEEKDAYS.indexOf(last) - from + 7) % 7
    add(Array.from({ length: span + 1 }, (_, step) => WEEKDAYS[(from + step) % 7]!))
  }
  return WEEKDAYS.filter((day) => out.includes(day))
}

function time24(raw: string): { at: string; half: boolean } | undefined {
  const text = raw.trim().toLowerCase().replace(/\./g, (dot, at: number, all: string) => /\d/.test(all[at + 1] ?? '') ? ':' : '').replace(/\s+/g, '')
  if (/noon|midday/.test(text)) return { at: '12:00', half: true }
  if (text === 'midnight') return { at: '00:00', half: true }
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/)
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const half = match[3]
  if (hour > 23 || minute > 59 || (half && hour > 12)) return undefined
  if (half === 'pm' && hour < 12) hour += 12
  if (half === 'am' && hour === 12) hour = 0
  return { at: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, half: Boolean(half) || hour >= 13 }
}

function later(at: string): string {
  return `${String(Number(at.slice(0, 2)) + 12).padStart(2, '0')}${at.slice(2)}`
}

/** "9am - 1pm, 2pm - 5pm" opens at 9 and closes at 5. "8 - 5" closes in the afternoon. */
export function timesIn(text: string): { open: string; close: string } | undefined {
  const ranges = [...text.matchAll(ONE_RANGE)]
  const first = ranges[0]
  const last = ranges[ranges.length - 1]
  if (!first || !last) return undefined
  const from = time24(first[1]!)
  const to = time24(last[2]!)
  if (!from || !to) return undefined
  let open = from.at
  let close = to.at
  if (!from.half && Number(open.slice(0, 2)) < 6) open = later(open)
  if (!to.half && close <= open && Number(close.slice(0, 2)) < 12) close = later(close)
  if (close <= open && close !== '00:00') return undefined
  return { open, close }
}

/** Every day-and-time statement in free text, in page order. Works with or without line breaks. */
export function hoursMentionedIn(text: string): HoursMention[] {
  const found: HoursMention[] = []
  for (const match of text.matchAll(DAYS_FIRST)) {
    const days = daysIn(match[1]!)
    if (!days.length) continue
    const times = match[2] ? timesIn(match[2]) : undefined
    if (match[2] && !times) continue
    const hours = days.map((day): OpeningDay => times ? { day, ...times } : { day, closed: true })
    found.push({ hours, quote: match[0].trim(), index: match.index ?? 0 })
  }
  const taken = found.map((item) => [item.index, item.index + item.quote.length] as const)
  for (const match of text.matchAll(TIMES_FIRST)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (taken.some(([from, to]) => start < to && end > from)) continue
    const days = daysIn(match[2]!)
    const times = timesIn(match[1]!)
    if (!days.length || !times) continue
    found.push({ hours: days.map((day) => ({ day, ...times })), quote: match[0].trim(), index: start })
  }
  return found.sort((a, b) => a.index - b.index)
}

/** The days on one line, read from its start: "Tuesday - Thursday : 8 am - 5 pm". */
export function hoursFromLine(line: string): OpeningDay[] {
  const first = hoursMentionedIn(line.trim())[0]
  return first && first.index === 0 ? first.hours : []
}

export interface HoursWeek {
  hours: OpeningDay[]
  /** Where in the text the week starts. */
  index: number
  /** A heading such as "Opening hours" stood just before it. */
  headed: boolean
}

/**
 * Statements close together form one week, as a site lists them under one heading.
 * One stray "Saturday 10am-2pm" in a blog post is not a week unless a heading such as "Opening hours" sits right before it.
 */
export function weeksIn(text: string): HoursWeek[] {
  const weeks: HoursWeek[] = []
  let current: { rows: OpeningDay[]; index: number; end: number } | undefined
  const close = () => {
    if (!current) return
    const headed = HOURS_HEADING.test(text.slice(Math.max(0, current.index - 120), current.index))
    const hours = WEEKDAYS.flatMap((day) => current!.rows.filter((row) => row.day === day).slice(0, 1))
    if (hours.length >= 3 || (headed && hours.length >= 1)) weeks.push({ hours, index: current.index, headed })
    current = undefined
  }
  for (const mention of hoursMentionedIn(text)) {
    const repeats = current && mention.hours.some((row) => current!.rows.some((seen) => seen.day === row.day))
    if (!current || repeats || mention.index - current.end > 60) {
      close()
      current = { rows: [], index: mention.index, end: mention.index }
    }
    current.rows.push(...mention.hours)
    current.end = mention.index + mention.quote.length
  }
  close()
  return weeks
}

/** The same week, written the same way, gives the same key. */
export function weekKey(hours: OpeningDay[]): string {
  return WEEKDAYS.map((day) => {
    const row = hours.find((item) => item.day === day)
    return row ? (row.closed ? 'x' : `${row.open}-${row.close}`) : '?'
  }).join(',')
}

const SCHEMA_DAYS: Record<string, Weekday> = { mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat', su: 'sun' }

function schemaDay(value: unknown): Weekday | undefined {
  const word = String(value ?? '').split('/').pop() ?? ''
  return SCHEMA_DAYS[word.toLowerCase().slice(0, 2)]
}

function schemaTime(value: unknown): string | undefined {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/)
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : undefined
}

/** "Mo-Fr 09:00-17:00", "Sa,Su 10:00-16:00", "Mo-Su": schema.org's openingHours text. */
function schemaHoursLine(line: string): OpeningDay[] {
  const match = line.trim().match(/^([A-Za-z,\s-]+?)(?:\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))?$/)
  if (!match) return []
  const days: Weekday[] = []
  for (const part of match[1]!.split(',')) {
    const [from, to] = part.split('-').map((item) => schemaDay(item.trim()))
    if (!from) continue
    const start = WEEKDAYS.indexOf(from)
    const span = to ? (WEEKDAYS.indexOf(to) - start + 7) % 7 : 0
    for (let step = 0; step <= span; step++) days.push(WEEKDAYS[(start + step) % 7]!)
  }
  const open = match[2] ? schemaTime(match[2]) : '00:00'
  const close = match[3] ? schemaTime(match[3]) : '23:59'
  return days.map((day) => ({ day, open: open!, close: close! }))
}

const SCHEMA_GROUP = /\b((?:mo|tu|we|th|fr|sa|su)(?:\s*[-,]\s*(?:mo|tu|we|th|fr|sa|su))*)\b(?:\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))?/gi

/** "Mo-Fr 07:30-17:00, Sa,Su 09:00-15:00" holds two groups. */
function schemaHoursText(text: string): OpeningDay[] {
  return [...text.matchAll(SCHEMA_GROUP)].flatMap((match) => schemaHoursLine(match[0]))
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit))
  else if (value && typeof value === 'object') {
    visit(value as Record<string, unknown>)
    Object.values(value).forEach((item) => walk(item, visit))
  }
}

/**
 * The hours a site declares for search engines (schema.org JSON-LD or microdata), which often
 * sit in the page when the visible hours are drawn by a script. Holiday overrides are skipped.
 */
export function hoursFromStructuredData(html: string): OpeningDay[] | undefined {
  const rows: OpeningDay[] = []
  const add = (row: OpeningDay) => {
    const seen = rows.find((item) => item.day === row.day)
    if (!seen) { rows.push(row); return }
    if (seen.closed || row.closed) return
    if (row.open! < seen.open!) seen.open = row.open
    if (row.close! > seen.close!) seen.close = row.close
  }
  for (const block of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try { data = JSON.parse(block[1]!.trim()) } catch { continue }
    walk(data, (node) => {
      const lines = node.openingHours
      for (const line of Array.isArray(lines) ? lines : [lines]) {
        if (typeof line === 'string') schemaHoursText(line).forEach(add)
      }
      const specs = node.openingHoursSpecification
      for (const spec of Array.isArray(specs) ? specs : specs ? [specs] : []) {
        if (!spec || typeof spec !== 'object' || 'validFrom' in spec || 'validThrough' in spec) continue
        const { dayOfWeek, opens, closes } = spec as Record<string, unknown>
        const open = schemaTime(opens)
        const close = schemaTime(closes)
        for (const raw of Array.isArray(dayOfWeek) ? dayOfWeek : [dayOfWeek]) {
          const day = schemaDay(raw)
          if (!day || !open || !close) continue
          add(open === '00:00' && close === '00:00' ? { day, closed: true } : { day, open, close })
        }
      }
    })
  }
  for (const tag of html.match(/<(?:meta|time)\b[^>]*itemprop\s*=\s*["']openingHours["'][^>]*>/gi) ?? []) {
    const content = tag.match(/\b(?:content|datetime)\s*=\s*["']([^"']+)["']/i)?.[1]
    if (content) schemaHoursText(content).forEach(add)
  }
  const hours = WEEKDAYS.flatMap((day) => rows.filter((row) => row.day === day))
  return hours.length ? hours : undefined
}

export interface PickedWeek<T> {
  hours: OpeningDay[]
  page: T
}

/**
 * The week the site repeats most (a footer on every page beats one page), then the fullest.
 * `other` is a different full week elsewhere on the site, for a "the site disagrees" note.
 * Hours declared for search engines count only when no page shows hours in its text.
 */
export function pickWeek<T extends { text: string; hours?: OpeningDay[] }>(pages: T[]): { best: PickedWeek<T>; other?: PickedWeek<T> } | null {
  const shown = pickShownWeek(pages)
  if (shown) return shown
  const declared = pages.find((page) => page.hours?.length)
  return declared ? { best: { hours: declared.hours!, page: declared } } : null
}

function pickShownWeek<T extends { text: string }>(pages: T[]): { best: PickedWeek<T>; other?: PickedWeek<T> } | null {
  const weeks = new Map<string, { hours: OpeningDay[]; count: number; headed: boolean; page: T; order: number }>()
  pages.forEach((page, pageIndex) => {
    for (const week of weeksIn(page.text)) {
      const key = weekKey(week.hours)
      const row = weeks.get(key) ?? { hours: week.hours, count: 0, headed: false, page, order: pageIndex * 1e6 + week.index }
      row.count += 1
      row.headed ||= week.headed
      weeks.set(key, row)
    }
  })
  const rows = [...weeks.values()].filter((row) => row.hours.some((day) => !day.closed))
  // A partial week that agrees with a fuller one (a "this week" widget that names only Monday, say) backs the fuller one.
  const fuller = (row: (typeof rows)[number]) => rows
    .filter((other) => other.hours.length > row.hours.length && row.hours.every((day) => weekKey([day]) === weekKey(other.hours.filter((item) => item.day === day.day))))
    .sort((a, b) => b.hours.length - a.hours.length)[0]
  const absorbed = new Set<(typeof rows)[number]>()
  for (const row of [...rows].sort((a, b) => a.hours.length - b.hours.length)) {
    const target = fuller(row)
    if (!target) continue
    target.count += row.count
    target.headed ||= row.headed
    absorbed.add(row)
  }
  const ranking = rows.filter((row) => !absorbed.has(row)).sort((a, b) =>
    b.count - a.count || b.hours.length - a.hours.length || Number(b.headed) - Number(a.headed) || a.order - b.order)
  const best = ranking[0]
  if (!best) return null
  // Only the same days with other times is a disagreement; a lunch menu served Monday to Friday is not.
  const sameDays = (row: (typeof rows)[number]) => row.hours.map((day) => day.day).join() === best.hours.map((day) => day.day).join()
  const other = ranking.slice(1).find(sameDays)
  return { best: { hours: best.hours, page: best.page }, ...(other ? { other: { hours: other.hours, page: other.page } } : {}) }
}

function clock(time: string | undefined): string {
  const match = (time ?? '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return time ?? ''
  const hour = Number(match[1])
  const suffix = hour >= 12 ? 'pm' : 'am'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return match[2] === '00' ? `${twelve}${suffix}` : `${twelve}:${match[2]}${suffix}`
}

function joinDays(days: Weekday[]): string {
  const runs: Weekday[][] = []
  for (const day of days) {
    const run = runs[runs.length - 1]
    if (run && WEEKDAYS.indexOf(run[run.length - 1]!) === WEEKDAYS.indexOf(day) - 1) run.push(day)
    else runs.push([day])
  }
  const names = runs.map((run) => run.length >= 3
    ? `${WEEKDAY_NAMES[run[0]!]} to ${WEEKDAY_NAMES[run[run.length - 1]!]}`
    : run.map((day) => WEEKDAY_NAMES[day]).join(' and '))
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "Monday 8am to 6pm. Tuesday to Thursday 8am to 5pm. Saturday and Sunday closed." Open days first, then closed ones. */
export function hoursSentence(hours: OpeningDay[]): string {
  const groups: Array<{ days: Weekday[]; label: string }> = []
  for (const day of WEEKDAYS) {
    const row = hours.find((item) => item.day === day)
    if (!row || row.closed || !row.open || !row.close) continue
    const label = row.open === '00:00' && row.close === '23:59' ? 'open all day' : `${clock(row.open)} to ${clock(row.close)}`
    const last = groups[groups.length - 1]
    const previous = last?.days[last.days.length - 1]
    if (last && last.label === label && previous && WEEKDAYS.indexOf(previous) === WEEKDAYS.indexOf(day) - 1) last.days.push(day)
    else groups.push({ days: [day], label })
  }
  const closed = WEEKDAYS.filter((day) => hours.find((item) => item.day === day)?.closed)
  const parts = groups.map((group) => `${group.days.length >= 3 ? `${WEEKDAY_NAMES[group.days[0]!]} to ${WEEKDAY_NAMES[group.days[group.days.length - 1]!]}` : group.days.map((day) => WEEKDAY_NAMES[day]).join(' and ')} ${group.label}`)
  if (closed.length) parts.push(`${joinDays(closed)} closed`)
  return parts.length ? `${parts.join('. ')}.` : ''
}
