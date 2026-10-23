import type { LiveSupport } from './api'

export const WEEK = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
] as const

export const TIMEZONES = [
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney', 'UTC',
]

export type LiveSupportTone = 'open' | 'closed' | 'off'

/** The header pill: what happens to a chat the bot hands over right now. */
export function liveSupportLabel(live: Pick<LiveSupport, 'state' | 'hours'>): { short: string; detail: string; tone: LiveSupportTone } {
  if (live.state === 'off') {
    return { short: 'Live support off', detail: 'The bot keeps every chat. Nobody is asked to take over.', tone: 'off' }
  }
  if (live.state === 'closed') {
    return {
      short: 'Live support: closed',
      detail: `Outside opening hours (${live.hours ?? 'not set'}). The bot keeps chats and tells guests when the team is on.`,
      tone: 'closed',
    }
  }
  return {
    short: 'Live support on',
    detail: live.hours
      ? `Inside opening hours (${live.hours}). Handed-over chats wait for the team in Chats.`
      : 'Around the clock. Handed-over chats wait for the team in Chats.',
    tone: 'open',
  }
}

/** Inbox settings saved before the switch existed meant "on" once a schedule was saved. */
export function savedLiveSupport(cfg: Record<string, unknown>): boolean {
  const live = cfg['liveSupport'] as { enabled?: unknown } | undefined
  if (live && typeof live.enabled === 'boolean') return live.enabled
  const hours = cfg['workingHours'] as { enabled?: boolean; start?: string; end?: string } | undefined
  if (!hours || hours.enabled === false) return false
  return Boolean(hours.start && hours.end)
}

export function savedDays(cfg: Record<string, unknown>): number[] {
  const hours = cfg['workingHours'] as { days?: unknown } | undefined
  const days = Array.isArray(hours?.days) ? hours.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : []
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6]
}

export function toggleDay(days: number[], day: number): number[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
  return next.length ? next.sort((a, b) => a - b) : days
}
