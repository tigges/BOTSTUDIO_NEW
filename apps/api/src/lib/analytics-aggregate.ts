import { prisma } from '@botstudio/db'
import {
  aggregateSamples, previousRange,
  type AggregateResult, type AnalyticsFilters, type AnalyticsMetric, type AnalyticsQuery, type AnalyticsSample,
} from '@botstudio/shared'
import { CHAT_OUTCOMES } from './chat-outcome.js'

type Range = { from: string; to: string }

export interface ChatRow { id: string; createdAt: Date; outcome: string | null; channel: string | null; assignedTo?: string | null }

const RATE_HITS: Partial<Record<AnalyticsMetric, (outcome: string) => boolean>> = {
  contained_rate: (o) => o.startsWith('contained'),
  resolved_by_bot_rate: (o) => o === 'contained_resolved',
  escalated_rate: (o) => o === 'escalated',
  abandoned_rate: (o) => o === 'abandoned',
}

const finished = (outcome: string | null): outcome is string => outcome != null && (CHAT_OUTCOMES as readonly string[]).includes(outcome)

/** Chats started in the range. Rates only count finished chats, each from its own outcome. */
export function chatSamples(metric: AnalyticsMetric, chats: ChatRow[]): AnalyticsSample[] {
  if (metric === 'conversations') return chats.map((c) => ({ at: c.createdAt, value: 1, channel: c.channel, outcome: c.outcome, agent: c.assignedTo ?? null }))
  const hit = RATE_HITS[metric]
  if (!hit) return []
  return chats.filter((c) => finished(c.outcome)).map((c) => ({ at: c.createdAt, value: hit(c.outcome!) ? 1 : 0, channel: c.channel, outcome: c.outcome, agent: c.assignedTo ?? null }))
}

/** Prisma filter for the chats a query covers. `range` is left out for event metrics that date by the event. */
export function chatWhere(tenantId: string, filters: AnalyticsFilters, range?: Range) {
  return {
    tenantId,
    ...(filters.botId ? { botId: filters.botId } : {}),
    ...(filters.channelId ? { channelId: filters.channelId } : {}),
    ...(filters.environment ? { environment: { kind: filters.environment } } : {}),
    ...(filters.testRuns === 'exclude' ? { testRunId: null } : filters.testRuns === 'only' ? { testRunId: { not: null } } : {}),
    ...(range ? { createdAt: { gte: new Date(range.from), lt: new Date(range.to) } } : {}),
  }
}

const CHAT_SELECT = { id: true, createdAt: true, outcome: true, assignedTo: true, channel: { select: { name: true } } } as const

async function chatsIn(tenantId: string, filters: AnalyticsFilters, range: Range): Promise<ChatRow[]> {
  const rows = await prisma.conversation.findMany({ where: chatWhere(tenantId, filters, range), select: CHAT_SELECT })
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, outcome: r.outcome, channel: r.channel?.name ?? null, assignedTo: r.assignedTo }))
}

async function csatSamples(tenantId: string, filters: AnalyticsFilters, range: Range): Promise<AnalyticsSample[]> {
  const rows = await prisma.csatResponse.findMany({
    where: { tenantId, rating: { not: 0 }, createdAt: { gte: new Date(range.from), lt: new Date(range.to) }, conversation: chatWhere(tenantId, filters) },
    select: { createdAt: true, rating: true, conversation: { select: { outcome: true, assignedTo: true, channel: { select: { name: true } } } } },
  })
  return rows.map((r) => ({ at: r.createdAt, value: r.rating > 0 ? 1 : 0, channel: r.conversation.channel?.name ?? null, outcome: r.conversation.outcome, agent: r.conversation.assignedTo }))
}

async function costSamples(tenantId: string, filters: AnalyticsFilters, range: Range): Promise<AnalyticsSample[]> {
  const calls = await prisma.llmCall.findMany({
    where: { tenantId, conversationId: { not: null }, createdAt: { gte: new Date(range.from), lt: new Date(range.to) } },
    select: { createdAt: true, costUsd: true, conversationId: true },
  })
  const ids = [...new Set(calls.map((c) => c.conversationId!))]
  const chats = ids.length
    ? await prisma.conversation.findMany({ where: { ...chatWhere(tenantId, filters), id: { in: ids } }, select: { id: true, outcome: true, assignedTo: true, channel: { select: { name: true } } } })
    : []
  const byId = new Map(chats.map((c) => [c.id, c]))
  return calls.flatMap((call) => {
    const chat = byId.get(call.conversationId!)
    return chat ? [{ at: call.createdAt, value: call.costUsd ?? 0, channel: chat.channel?.name ?? null, outcome: chat.outcome, agent: chat.assignedTo }] : []
  })
}

async function replySamples(tenantId: string, filters: AnalyticsFilters, range: Range): Promise<AnalyticsSample[]> {
  const params: unknown[] = [tenantId, new Date(range.from), new Date(range.to)]
  const where = ['mu."tenantId" = $1', 'mu."authorKind" = \'user\'', 'mu."createdAt" >= $2', 'mu."createdAt" < $3']
  if (filters.botId) { params.push(filters.botId); where.push(`c."botId" = $${params.length}`) }
  if (filters.channelId) { params.push(filters.channelId); where.push(`c."channelId" = $${params.length}`) }
  if (filters.environment) { params.push(filters.environment); where.push(`e.kind = $${params.length}`) }
  if (filters.testRuns === 'exclude') where.push('c."testRunId" IS NULL')
  if (filters.testRuns === 'only') where.push('c."testRunId" IS NOT NULL')
  type Row = { at: Date; ms: number; channel: string | null; outcome: string | null; agent: string | null }
  const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<Row[]>)(
    `SELECT mu."createdAt" AS at,
            (EXTRACT(EPOCH FROM (mb."createdAt" - mu."createdAt")) * 1000)::float8 AS ms,
            ch.name AS channel, c.outcome, c."assignedTo" AS agent
       FROM messages mu
       JOIN conversations c ON c.id = mu."conversationId"
       JOIN environments e ON e.id = c."environmentId"
       LEFT JOIN channels ch ON ch.id = c."channelId"
       JOIN LATERAL (
         SELECT "createdAt" FROM messages
          WHERE "conversationId" = mu."conversationId" AND "authorKind" = 'bot' AND "createdAt" > mu."createdAt"
          ORDER BY "createdAt" ASC LIMIT 1
       ) mb ON true
      WHERE ${where.join(' AND ')}`,
    ...params,
  )
  return rows.map((r) => ({ at: new Date(r.at), value: Number(r.ms), channel: r.channel, outcome: r.outcome, agent: r.agent }))
}

async function samplesFor(tenantId: string, metric: AnalyticsMetric, filters: AnalyticsFilters, range: Range): Promise<AnalyticsSample[]> {
  if (metric === 'csat_score') return csatSamples(tenantId, filters, range)
  if (metric === 'llm_cost') return costSamples(tenantId, filters, range)
  if (metric === 'first_reply_ms') return replySamples(tenantId, filters, range)
  return chatSamples(metric, await chatsIn(tenantId, filters, range))
}

/** Samples carry the teammate's id; the agent dimension shows their name. */
async function nameAgents(tenantId: string, samples: AnalyticsSample[]): Promise<AnalyticsSample[]> {
  const ids = [...new Set(samples.map((s) => s.agent).filter((id): id is string => Boolean(id)))]
  if (!ids.length) return samples
  const users = await prisma.user.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, displayName: true } })
  const names = new Map(users.map((u) => [u.id, u.displayName]))
  return samples.map((s) => (s.agent ? { ...s, agent: names.get(s.agent) ?? 'Former teammate' } : s))
}

export async function runAggregate(tenantId: string, query: AnalyticsQuery): Promise<AggregateResult> {
  const [current, previous] = await Promise.all([
    samplesFor(tenantId, query.metric, query.filters, query.range),
    samplesFor(tenantId, query.metric, query.filters, previousRange(query.range)),
  ])
  const named = query.dimensions.includes('agent') ? await nameAgents(tenantId, current) : current
  return aggregateSamples(query, named, previous)
}
