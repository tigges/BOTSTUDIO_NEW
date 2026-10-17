/**
 * Booking times: a mistyped day still counts, then we offer three times
 * with the stylist, from the studio hours. The diary API is later —
 * these are the usual times on an open day.
 */

import type { StudioCatalog } from './catalog.js'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
type Weekday = (typeof WEEKDAYS)[number]

const DAY_ALIAS: Record<string, string> = {
  today: 'today',
  tonight: 'today',
  tomorrow: 'tomorrow',
  tmrw: 'tomorrow',
  tomoz: 'tomorrow',
  tomorow: 'tomorrow',
  tommorrow: 'tomorrow',
  tomrw: 'tomorrow',
  tomo: 'tomorrow',
  mon: 'monday',
  monday: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  tuesday: 'tuesday',
  wed: 'wednesday',
  wednesday: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  thursday: 'thursday',
  fri: 'friday',
  friday: 'friday',
  sat: 'saturday',
  saturday: 'saturday',
  sun: 'sunday',
  sunday: 'sunday',
}

const CANDIDATE_HOURS = [10, 11, 12, 14, 15, 17]

export interface DayHours {
  open: number
  close: number
}

export interface BookingTimeTaken {
  spoken?: string
  ask?: string
  day?: string
  slots?: string[]
}

function lev(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 9
  const rows = a.length + 1
  const cols = b.length + 1
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i += 1) dp[i]![0] = i
  for (let j = 0; j < cols; j += 1) dp[0]![j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
    }
  }
  return dp[a.length]![b.length]!
}

function closeDayWord(word: string): string | null {
  const alias = DAY_ALIAS[word]
  if (alias) return alias
  for (const name of ['tomorrow', 'today', ...WEEKDAYS]) {
    if (word.length >= 6 && name.length >= 6 && word.slice(0, 3) === name.slice(0, 3) && lev(word, name) <= 2) {
      return name
    }
  }
  return null
}

function titleDay(day: string, start = false): string {
  if ((day === 'today' || day === 'tomorrow') && !start) return day
  return day.charAt(0).toUpperCase() + day.slice(1)
}

function stylistLabel(raw?: string): string {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('junior')) return 'a junior stylist'
  return 'a senior stylist'
}

function parseClock(text: string, offered?: string[]): string | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    ?? text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (match) {
    let hour = Number(match[1])
    const mer = match[3]?.toLowerCase()
    if (mer === 'pm' && hour < 12) hour += 12
    if (mer === 'am' && hour === 12) hour = 0
    if (!mer && hour <= 7) hour += 12
    if (hour < 0 || hour > 23) return null
    return spokenClock(hour)
  }
  const bare = text.trim().match(/^(\d{1,2})$/)
  if (!bare || !offered?.length) return null
  const n = Number(bare[1])
  return offered.find((slot) => {
    const hour = clockHour(slot)
    return hour === n || hour === n + 12
  }) ?? null
}

function spokenClock(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  if (hour > 12) return `${hour - 12}pm`
  return `${hour}am`
}

function clockHour(spoken: string): number | null {
  const match = spoken.match(/^(\d{1,2})(am|pm)$/i)
  if (!match) return null
  let hour = Number(match[1])
  const mer = match[2]?.toLowerCase()
  if (mer === 'pm' && hour < 12) hour += 12
  if (mer === 'am' && hour === 12) hour = 0
  return hour
}

function periodFilter(text: string): 'morning' | 'afternoon' | 'evening' | null {
  if (/\bevening\b|\bafter\s*5\b|\bafter\s*five\b/i.test(text)) return 'evening'
  if (/\bafternoon\b|\bafter\s*noon\b/i.test(text)) return 'afternoon'
  if (/\bmorning\b/i.test(text)) return 'morning'
  return null
}

function slotFitsPeriod(slot: string, period: 'morning' | 'afternoon' | 'evening' | null): boolean {
  if (!period) return true
  const hour = clockHour(slot)
  if (hour === null) return true
  if (period === 'morning') return hour < 12
  if (period === 'afternoon') return hour >= 12 && hour < 17
  return hour >= 17
}

function parseHourToken(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const mer = match[3]?.toLowerCase()
  if (mer === 'pm' && hour < 12) hour += 12
  if (mer === 'am' && hour === 12) hour = 0
  if (!mer && hour <= 8) hour += 12
  return hour
}

function weekdayIndex(name: string): number {
  return WEEKDAYS.indexOf(name as Weekday)
}

export function hoursFromCatalog(catalog?: StudioCatalog | null): string {
  const hit = catalog?.facts.find((fact) => fact.id === 'hours' || /hour/i.test(fact.title))
  return hit?.fact ?? ''
}

function eachDay(from: Weekday, to: Weekday, span: 'range' | 'pair', visit: (day: Weekday) => void) {
  if (span === 'pair' || from === to) {
    visit(from)
    if (from !== to) visit(to)
    return
  }
  const start = weekdayIndex(from)
  const end = weekdayIndex(to)
  if (start < 0 || end < 0) return
  for (let i = start; ; i = (i + 1) % 7) {
    visit(WEEKDAYS[i]!)
    if (i === end) break
  }
}

export function parseOpeningHours(text: string): Partial<Record<Weekday, DayHours | 'closed'>> {
  const hours: Partial<Record<Weekday, DayHours | 'closed'>> = {}
  const blob = text.replace(/\n+/g, ' ')
  const range = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s*(to|–|—|-|and|&)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday))?[,\s]+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|–|—|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi
  for (const match of blob.matchAll(range)) {
    const from = match[1]!.toLowerCase() as Weekday
    const joiner = (match[2] ?? 'to').toLowerCase()
    const to = (match[3] ?? match[1]!).toLowerCase() as Weekday
    const open = parseHourToken(match[4] ?? '')
    const close = parseHourToken(match[5] ?? '')
    if (open === null || close === null) continue
    eachDay(from, to, /and|&/.test(joiner) ? 'pair' : 'range', (day) => {
      hours[day] = { open, close }
    })
  }
  const closed = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s*(to|–|—|-|and|&)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday))?\s+(?:are\s+)?closed\b/gi
  for (const match of blob.matchAll(closed)) {
    const from = match[1]!.toLowerCase() as Weekday
    const joiner = (match[2] ?? 'to').toLowerCase()
    const to = (match[3] ?? match[1]!).toLowerCase() as Weekday
    eachDay(from, to, /and|&/.test(joiner) ? 'pair' : 'range', (day) => {
      hours[day] = 'closed'
    })
  }
  return hours
}

export function slotsForDay(
  hours: DayHours | 'closed' | undefined,
  period: 'morning' | 'afternoon' | 'evening' | null = null,
): string[] {
  if (!hours || hours === 'closed') return []
  const inside = CANDIDATE_HOURS.filter((hour) => hour > hours.open && hour < hours.close).map(spokenClock)
  const fitted = inside.filter((slot) => slotFitsPeriod(slot, period))
  const pool = fitted.length > 0 ? fitted : inside
  if (pool.length <= 3) return pool
  return [pool[0]!, pool[Math.floor(pool.length / 2)]!, pool[pool.length - 1]!]
}

function weekdayFromLabel(day: string, now: Date): Weekday | null {
  if (day === 'today') return WEEKDAYS[now.getDay()] ?? null
  if (day === 'tomorrow') return WEEKDAYS[(now.getDay() + 1) % 7] ?? null
  if ((WEEKDAYS as readonly string[]).includes(day)) return day as Weekday
  return null
}

function hoursFor(
  hours: Partial<Record<Weekday, DayHours | 'closed'>>,
  weekday: Weekday | null,
): DayHours | 'closed' | undefined {
  if (!weekday) return undefined
  const hit = hours[weekday]
  if (hit) return hit
  if (Object.keys(hours).length > 0) return 'closed'
  return undefined
}

function nextOpen(hours: Partial<Record<Weekday, DayHours | 'closed'>>, from: Weekday, nowDay: Weekday): Weekday | null {
  const start = weekdayIndex(from)
  if (start < 0) return null
  for (let step = 1; step <= 7; step += 1) {
    const name = WEEKDAYS[(start + step) % 7]!
    const slot = hours[name]
    if (slot && slot !== 'closed') return name
  }
  if (Object.keys(hours).length === 0) {
    return from === nowDay ? WEEKDAYS[(weekdayIndex(nowDay) + 1) % 7]! : from
  }
  return null
}

function spokenSlots(slots: string[]): string {
  if (slots.length === 0) return ''
  if (slots.length === 1) return slots[0] ?? ''
  const copy = [...slots]
  const last = copy.pop()
  return `${copy.join(', ')}, or ${last}`
}

export function takeBookingTime(input: {
  heard: string
  previousDay?: string
  hoursText?: string
  stylist?: string
  now?: Date
  offered?: string[]
}): BookingTimeTaken {
  const now = input.now ?? new Date()
  const hours = parseOpeningHours(input.hoursText ?? '')
  const heard = input.heard.toLowerCase().replace(/\s+/g, ' ').trim()
  const words = heard.match(/[a-z0-9']+/g) ?? []
  let day = input.previousDay?.trim() || ''
  for (const word of words) {
    const hit = closeDayWord(word)
    if (hit) {
      day = hit
      break
    }
  }
  const clock = parseClock(heard, input.offered)
  const period = periodFilter(heard)
  const weekday = day ? weekdayFromLabel(day, now) : null
  const dayHours = hoursFor(hours, weekday)

  if (clock) {
    const label = day ? `${titleDay(day)} at ${clock}` : clock
    if (dayHours === 'closed') {
      const next = weekday ? nextOpen(hours, weekday, WEEKDAYS[now.getDay()]!) : null
      const nextHours = hoursFor(hours, next)
      const slots = slotsForDay(nextHours && nextHours !== 'closed' ? nextHours : { open: 10, close: 20 })
      return {
        day: next ?? day,
        slots,
        ask: `We're closed ${titleDay(weekday ?? day, true)}. ${titleDay(next ?? 'tuesday', true)} with ${stylistLabel(input.stylist)} I have ${spokenSlots(slots)}. Which time?`,
      }
    }
    return { spoken: label, day: day || undefined }
  }

  if (!day) {
    return { ask: 'When would suit you? A day, and I will offer times with that stylist.' }
  }

  let offerDay = day
  let offerWeekday = weekday
  let closedNote = ''
  if (dayHours === 'closed' && weekday) {
    const next = nextOpen(hours, weekday, WEEKDAYS[now.getDay()]!)
    closedNote = `We're closed ${titleDay(weekday, true)}. `
    offerDay = next ?? 'tuesday'
    offerWeekday = (next ?? 'tuesday') as Weekday
  }

  const offerHours = hoursFor(hours, offerWeekday)
  const slots = slotsForDay(offerHours && offerHours !== 'closed' ? offerHours : { open: 10, close: 20 }, period)
  if (slots.length === 1) {
    return { spoken: `${titleDay(offerDay)} at ${slots[0]}`, day: offerDay }
  }
  return {
    day: offerDay,
    slots,
    ask: `${closedNote}${titleDay(offerDay, true)} with ${stylistLabel(input.stylist)} I have ${spokenSlots(slots)}. Which time?`,
  }
}
