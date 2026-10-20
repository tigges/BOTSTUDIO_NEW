/**
 * SLA clocks and working-hours away replies.
 *
 * Targets live in BotConfig.inboxConfig:
 *   { sla: { first_response, resolution }, workingHours: { start, end, timezone, awayMessage }, alwaysHuman: string[] }
 *
 * First response is met by the first outbound reply (bot, agent, or the away message).
 * Resolution is met when the conversation is resolved or closed before resolutionDueAt.
 * The bot answers 24/7. Working hours are off until a queue window is saved.
 * That window is for people and the queue clock. It does not replace the bot.
 */

import { prisma } from '@ybot/db'
import { handoverList } from '@ybot/shared'
import { triggerRules } from './automation-engine.js'

export const DEFAULT_AWAY_MESSAGE =
  "Thanks for your message. We're currently outside our working hours and will reply when the team is back."

export interface WorkingHours {
  /** False until someone limits the queue. The bot answers either way. */
  enabled: boolean
  start: string
  end: string
  timezone: string
  awayMessage: string
}

export interface InboxPolicy {
  sla: { firstResponseHours: number; resolutionHours: number }
  workingHours: WorkingHours
  /** Words and phrases that always send the chat to a person, ahead of any journey. */
  alwaysHuman: string[]
}

export const DEFAULT_POLICY: InboxPolicy = {
  sla: { firstResponseHours: 1, resolutionHours: 24 },
  workingHours: {
    enabled: false,
    start: '09:00',
    end: '18:00',
    timezone: 'Europe/London',
    awayMessage: DEFAULT_AWAY_MESSAGE,
  },
  alwaysHuman: [],
}

export interface SlaSnapshot {
  id: string
  botId: string
  tenantId: string
  status: string
  createdAt: Date
  resolvedAt: Date | null
  firstResponseDueAt: Date | null
  resolutionDueAt: Date | null
  firstRespondedAt: Date | null
  slaBreachedAt: Date | null
  /** Kept as it was: stamping a clock is bookkeeping, not activity in the chat. */
  updatedAt?: Date
}

export function parseInboxPolicy(raw: unknown): InboxPolicy {
  const cfg = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const sla = cfg['sla'] && typeof cfg['sla'] === 'object' ? cfg['sla'] as Record<string, unknown> : {}
  const hours = cfg['workingHours'] && typeof cfg['workingHours'] === 'object'
    ? cfg['workingHours'] as Record<string, unknown>
    : {}
  const away = typeof hours['awayMessage'] === 'string' && hours['awayMessage'].trim()
    ? hours['awayMessage'].trim()
    : DEFAULT_AWAY_MESSAGE
  const start = clock(hours['start'])
  const end = clock(hours['end'])
  const enabled = hours['enabled'] === false ? false : start != null && end != null
  return {
    sla: {
      firstResponseHours: positiveHours(sla['first_response'], DEFAULT_POLICY.sla.firstResponseHours),
      resolutionHours: positiveHours(sla['resolution'], DEFAULT_POLICY.sla.resolutionHours),
    },
    workingHours: {
      enabled,
      start: start ?? DEFAULT_POLICY.workingHours.start,
      end: end ?? DEFAULT_POLICY.workingHours.end,
      timezone: typeof hours['timezone'] === 'string' && hours['timezone'] ? hours['timezone'] : DEFAULT_POLICY.workingHours.timezone,
      awayMessage: away,
    },
    alwaysHuman: handoverList(cfg['alwaysHuman']).slice(0, 100),
  }
}

export function isWithinWorkingHours(hours: WorkingHours, now: Date): boolean {
  if (!hours.enabled) return true
  const start = clockMinutes(hours.start)
  const end = clockMinutes(hours.end)
  if (start == null || end == null || start === end) return true
  const nowMinutes = zonedMinutes(now, hours.timezone)
  if (start < end) return nowMinutes >= start && nowMinutes < end
  return nowMinutes >= start || nowMinutes < end
}

export function slaLabel(input: {
  status: string
  createdAt: Date
  resolvedAt: Date | null
  firstResponseDueAt: Date | null
  resolutionDueAt: Date | null
  firstRespondedAt: Date | null
  policy: InboxPolicy
  now: Date
}): string | null {
  const firstDue = input.firstResponseDueAt ?? addHours(input.createdAt, input.policy.sla.firstResponseHours)
  const resolutionDue = input.resolutionDueAt ?? addHours(input.createdAt, input.policy.sla.resolutionHours)
  const closed = input.status === 'resolved' || input.status === 'closed'
  if (closed) {
    const at = input.resolvedAt ?? input.now
    return at.getTime() > resolutionDue.getTime() ? 'Breached' : null
  }
  if (input.firstRespondedAt == null && input.now.getTime() > firstDue.getTime()) return 'Breached'
  if (input.now.getTime() > resolutionDue.getTime()) return 'Breached'
  const target = input.firstRespondedAt == null ? firstDue : resolutionDue
  return formatRemaining(target.getTime() - input.now.getTime())
}

/** Start clocks on the first inbound message. The away string is optional for a human notice. Bot routes ignore it and keep answering. */
export async function onInboundCustomerMessage(opts: {
  conversationId: string
  botId: string
  now?: Date
}): Promise<string | null> {
  const now = opts.now ?? new Date()
  const [convo, cfg] = await Promise.all([
    prisma.conversation.findUnique({ where: { id: opts.conversationId } }),
    prisma.botConfig.findUnique({ where: { botId: opts.botId } }),
  ])
  if (!convo) return null
  const policy = parseInboxPolicy(cfg?.inboxConfig)
  const due = {
    firstResponseDueAt: convo.firstResponseDueAt ?? addHours(convo.createdAt, policy.sla.firstResponseHours),
    resolutionDueAt: convo.resolutionDueAt ?? addHours(convo.createdAt, policy.sla.resolutionHours),
  }
  if (!convo.firstResponseDueAt) {
    await prisma.conversation.update({ where: { id: convo.id }, data: due }).catch(() => {})
  }
  const open = isWithinWorkingHours(policy.workingHours, now)

  if (!open) {
    const claimed = await prisma.conversation.updateMany({
      where: { id: convo.id, afterHoursNotifiedAt: null },
      data: { afterHoursNotifiedAt: now },
    })
    if (claimed.count === 1) return policy.workingHours.awayMessage
  }

  await stampBreach({ ...convo, ...due }, policy, now)
  return null
}

export async function onOutboundReply(conversationId: string, now = new Date()): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, firstRespondedAt: null },
    data: { firstRespondedAt: now },
  })
}

export async function attachSlaLabels<T extends SlaSnapshot>(rows: T[], now = new Date()): Promise<Array<T & { sla: string | null }>> {
  if (rows.length === 0) return []
  const botIds = [...new Set(rows.map((r) => r.botId))]
  const configs = await prisma.botConfig.findMany({ where: { botId: { in: botIds } } })
  const policies = new Map(configs.map((c) => [c.botId, parseInboxPolicy(c.inboxConfig)]))

  const unanswered = rows.filter((r) => r.firstRespondedAt == null).map((r) => r.id)
  const firstReplies = new Map<string, Date>()
  if (unanswered.length > 0) {
    const grouped = await prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: unanswered }, direction: 'outbound' },
      _min: { createdAt: true },
    })
    for (const group of grouped) {
      if (group._min.createdAt) firstReplies.set(group.conversationId, group._min.createdAt)
    }
  }

  const labeled = rows.map((row) => {
    const policy = policies.get(row.botId) ?? DEFAULT_POLICY
    const firstRespondedAt = row.firstRespondedAt ?? firstReplies.get(row.id) ?? null
    const sla = slaLabel({ ...row, firstRespondedAt, policy, now })
    return { row, policy, firstRespondedAt, sla }
  })

  await Promise.all(labeled.map(({ row, policy, firstRespondedAt, sla }) =>
    stampBreach({ ...row, firstRespondedAt }, policy, now, sla, row.firstRespondedAt == null && firstRespondedAt != null),
  ))
  return labeled.map(({ row, sla }) => ({ ...row, sla }))
}

async function stampBreach(
  row: SlaSnapshot,
  policy: InboxPolicy,
  now: Date,
  knownLabel?: string | null,
  persistFirstReply = false,
): Promise<void> {
  const label = knownLabel === undefined ? slaLabel({ ...row, policy, now }) : knownLabel
  const data: {
    firstResponseDueAt?: Date
    resolutionDueAt?: Date
    firstRespondedAt?: Date
    slaBreachedAt?: Date
    updatedAt?: Date
  } = {}
  if (!row.firstResponseDueAt) data.firstResponseDueAt = addHours(row.createdAt, policy.sla.firstResponseHours)
  if (!row.resolutionDueAt) data.resolutionDueAt = addHours(row.createdAt, policy.sla.resolutionHours)
  if (persistFirstReply && row.firstRespondedAt) data.firstRespondedAt = row.firstRespondedAt
  const newlyBreached = label === 'Breached' && !row.slaBreachedAt
  if (newlyBreached) data.slaBreachedAt = now
  if (Object.keys(data).length === 0) return
  if (row.updatedAt) data.updatedAt = row.updatedAt
  await prisma.conversation.update({ where: { id: row.id }, data }).catch(() => {})
  if (newlyBreached) {
    triggerRules('sla.breached', {
      tenantId: row.tenantId,
      botId: row.botId,
      conversationId: row.id,
      conversationStatus: row.status,
    }).catch(() => {})
  }
}

function positiveHours(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function clock(value: unknown): string | null {
  return typeof value === 'string' && clockMinutes(value) != null ? value : null
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

function zonedMinutes(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    return ((hour === 24 ? 0 : hour) * 60) + minute
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes()
  }
}

function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 60 * 60 * 1000)
}

function formatRemaining(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes}m left`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h left`
  return `${Math.floor(hours / 24)}d left`
}
