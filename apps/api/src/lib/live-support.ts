/**
 * The live-support switch: whether a chat the bot hands over reaches a person.
 *
 * Off: the bot keeps every chat, for a team without a receptionist or a machine-only test.
 * On: chats go to the Inbox, either around the clock or only inside the opening hours.
 * Stored in BotConfig.inboxConfig next to the working hours (see sla.ts).
 */

import { liveSupportNow, parseInboxPolicy, type LiveSupportState } from './sla.js'

export interface LiveSupportView {
  enabled: boolean
  followHours: boolean
  /** Right now: off, closed (outside the hours) or open. */
  state: LiveSupportState
  available: boolean
  hours: string | null
  schedule: { start: string; end: string; timezone: string; days: number[] }
}

export interface LiveSupportChange {
  enabled?: boolean
  followHours?: boolean
  start?: string
  end?: string
  timezone?: string
  days?: number[]
}

type Config = Record<string, unknown>

function asConfig(raw: unknown): Config {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Config) } : {}
}

export function liveSupportView(inboxConfig: unknown, now = new Date()): LiveSupportView {
  const policy = parseInboxPolicy(inboxConfig)
  const live = liveSupportNow(policy, now)
  const { start, end, timezone, days } = policy.workingHours
  return {
    enabled: policy.liveSupport.enabled,
    followHours: policy.workingHours.enabled,
    state: live.state,
    available: live.available,
    hours: live.hours,
    schedule: { start, end, timezone, days },
  }
}

/** The saved settings with the switch or the schedule changed. Everything else is kept. */
export function withLiveSupport(inboxConfig: unknown, change: LiveSupportChange): Config {
  const cfg = asConfig(inboxConfig)
  const policy = parseInboxPolicy(cfg)
  const hours = asConfig(cfg['workingHours'])
  const followHours = change.followHours ?? policy.workingHours.enabled
  const nextHours: Config = {
    ...hours,
    enabled: followHours,
    start: change.start ?? policy.workingHours.start,
    end: change.end ?? policy.workingHours.end,
    timezone: change.timezone ?? policy.workingHours.timezone,
    days: change.days ?? policy.workingHours.days,
  }
  return {
    ...cfg,
    workingHours: nextHours,
    liveSupport: { enabled: change.enabled ?? policy.liveSupport.enabled },
  }
}

/**
 * Saving Inbox settings from a page that does not send the switch keeps the switch as it was.
 * Without this an older page would turn live support back to "on whenever hours are saved".
 */
export function keepLiveSupportSwitch(before: unknown, next: Config): Config {
  if (next['liveSupport'] !== undefined) return next
  const saved = asConfig(before)['liveSupport']
  return saved === undefined ? next : { ...next, liveSupport: saved }
}
