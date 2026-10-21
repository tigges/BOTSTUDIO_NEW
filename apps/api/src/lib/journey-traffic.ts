export interface TrafficRow {
  flowId: string
  conversationId: string
}

type TrafficChat = { id: string; status: string; assignedTo: string | null; environmentId: string; testRunId: string | null }
type ChatSelect = { id: true; status: true; assignedTo: true; environmentId: true; testRunId: true }

export interface TrafficDb {
  flowVersion: {
    findMany: (args: {
      where: { flow: { botId: string; tenantId: string } }
      select: { id: true; flowId: true }
    }) => Promise<Array<{ id: string; flowId: string }>>
  }
  stepLog: {
    findMany: (args: {
      where: { tenantId: string; createdAt: { gte: Date }; flowVersionId: { in: string[] } }
      select: { conversationId: true; flowVersionId: true }
      distinct: ['conversationId', 'flowVersionId']
    }) => Promise<Array<{ conversationId: string; flowVersionId: string }>>
  }
  conversation: {
    findMany: (args: {
      where: { tenantId: string; botId?: string; id?: { in: string[] }; createdAt?: { gte: Date } }
      select: ChatSelect
    }) => Promise<TrafficChat[]>
  }
}

/** How the chats that entered a chapter ended. */
export interface ChapterOutcome {
  chats: number
  /** Closed by the bot with nobody from the team on the chat. */
  bot: number
  /** Handed to the team, or closed by a person. */
  person: number
  /** Still open. */
  open: number
}

/** Distinct chats per chapter. A chat that walks two chapters counts on both. */
export function tallyJourneyChats(rows: TrafficRow[]): Record<string, number> {
  const seen = new Map<string, Set<string>>()
  for (const row of rows) {
    const chats = seen.get(row.flowId) ?? new Set<string>()
    chats.add(row.conversationId)
    seen.set(row.flowId, chats)
  }
  return Object.fromEntries([...seen].map(([flowId, chats]) => [flowId, chats.size]))
}

export function tallyJourneyOutcomes(
  rows: TrafficRow[],
  chats: Map<string, { status: string; assignedTo: string | null }>,
): Record<string, ChapterOutcome> {
  const seen = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!chats.has(row.conversationId)) continue
    const ids = seen.get(row.flowId) ?? new Set<string>()
    ids.add(row.conversationId)
    seen.set(row.flowId, ids)
  }
  return Object.fromEntries([...seen].map(([flowId, ids]) => {
    const outcome: ChapterOutcome = { chats: 0, bot: 0, person: 0, open: 0 }
    for (const id of ids) {
      const chat = chats.get(id)!
      outcome.chats += 1
      if (chat.status === 'escalated' || (chat.status !== 'active' && chat.assignedTo)) outcome.person += 1
      else if (chat.status === 'resolved' || chat.status === 'closed') outcome.bot += 1
      else outcome.open += 1
    }
    return [flowId, outcome]
  }))
}

export interface JourneyTraffic {
  chats: Record<string, number>
  outcomes: Record<string, ChapterOutcome>
  total: ChapterOutcome
  /** Chats that started at least one chapter, per environment, so an empty environment can point to a busy one. */
  byEnvironment: Record<string, number>
  /** Chats opened in the window that never started a chapter, so the total adds up to the Inbox. */
  unstarted: number
  /** Scheduled test-run chats among the counted chats. */
  testRuns: number
}

const NO_OUTCOME: ChapterOutcome = { chats: 0, bot: 0, person: 0, open: 0 }
const SELECT: ChatSelect = { id: true, status: true, assignedTo: true, environmentId: true, testRunId: true }

export async function journeyTraffic(
  db: TrafficDb,
  tenantId: string,
  botId: string,
  since: Date,
  opts: { environmentId?: string; includeTestRuns?: boolean } = {},
): Promise<JourneyTraffic> {
  const { environmentId, includeTestRuns = true } = opts
  const versions = await db.flowVersion.findMany({
    where: { flow: { botId, tenantId } },
    select: { id: true, flowId: true },
  })
  const flowByVersion = new Map(versions.map((version) => [version.id, version.flowId]))
  const logs = versions.length === 0 ? [] : await db.stepLog.findMany({
    where: {
      tenantId,
      createdAt: { gte: since },
      flowVersionId: { in: versions.map((version) => version.id) },
    },
    select: { conversationId: true, flowVersionId: true },
    distinct: ['conversationId', 'flowVersionId'],
  })
  const rows = logs.flatMap((log) => {
    const flowId = flowByVersion.get(log.flowVersionId)
    return flowId ? [{ flowId, conversationId: log.conversationId }] : []
  })
  const opened = await db.conversation.findMany({ where: { tenantId, botId, createdAt: { gte: since } }, select: SELECT })
  const known = new Map(opened.map((chat) => [chat.id, chat]))
  const older = [...new Set(rows.map((row) => row.conversationId))].filter((id) => !known.has(id))
  if (older.length) for (const chat of await db.conversation.findMany({ where: { tenantId, id: { in: older } }, select: SELECT })) known.set(chat.id, chat)

  const counted = (chat: TrafficChat) => includeTestRuns || !chat.testRunId
  const started = new Set(rows.map((row) => row.conversationId))
  const byEnvironment: Record<string, number> = {}
  for (const id of started) {
    const chat = known.get(id)
    if (chat && counted(chat)) byEnvironment[chat.environmentId] = (byEnvironment[chat.environmentId] ?? 0) + 1
  }

  const chats = new Map([...known.values()]
    .filter((chat) => counted(chat) && (!environmentId || chat.environmentId === environmentId))
    .map((chat) => [chat.id, chat]))
  const kept = rows.filter((row) => chats.has(row.conversationId))
  const total = tallyJourneyOutcomes(kept.map((row) => ({ flowId: 'all', conversationId: row.conversationId })), chats)['all'] ?? NO_OUTCOME
  const unstarted = opened.filter((chat) => chats.has(chat.id) && !started.has(chat.id)).length
  const testRuns = new Set(kept.filter((row) => chats.get(row.conversationId)?.testRunId).map((row) => row.conversationId)).size
  return { chats: tallyJourneyChats(kept), outcomes: tallyJourneyOutcomes(kept, chats), total, byEnvironment, unstarted, testRuns }
}

/** Marks a chat as having entered a named chapter, so the Traffic tab can count it. Reads flows, never writes them. */
export async function logChapterEntry(
  db: typeof import('@botstudio/db').prisma,
  input: { tenantId: string; botId: string; conversationId: string; chapter: string; at: Date },
): Promise<boolean> {
  const version = await db.flowVersion.findFirst({
    where: { flow: { botId: input.botId, tenantId: input.tenantId, name: input.chapter } },
    select: { id: true },
    orderBy: { version: 'desc' },
  })
  if (!version) return false
  await db.stepLog.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      flowVersionId: version.id,
      nodeId: 'start',
      nodeKind: 'trigger_start',
      createdAt: input.at,
    },
  })
  return true
}
