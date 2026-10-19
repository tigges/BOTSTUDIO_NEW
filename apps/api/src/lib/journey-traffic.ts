export interface TrafficRow {
  flowId: string
  conversationId: string
}

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

export async function journeyChatCounts(
  db: TrafficDb,
  tenantId: string,
  botId: string,
  since: Date,
): Promise<Record<string, number>> {
  const versions = await db.flowVersion.findMany({
    where: { flow: { botId, tenantId } },
    select: { id: true, flowId: true },
  })
  if (versions.length === 0) return {}
  const flowByVersion = new Map(versions.map((version) => [version.id, version.flowId]))
  const logs = await db.stepLog.findMany({
    where: {
      tenantId,
      createdAt: { gte: since },
      flowVersionId: { in: versions.map((version) => version.id) },
    },
    select: { conversationId: true, flowVersionId: true },
    distinct: ['conversationId', 'flowVersionId'],
  })
  return tallyJourneyChats(logs.flatMap((log) => {
    const flowId = flowByVersion.get(log.flowVersionId)
    return flowId ? [{ flowId, conversationId: log.conversationId }] : []
  }))
}

/** Marks a chat as having entered a named chapter, so the Traffic tab can count it. Reads flows, never writes them. */
export async function logChapterEntry(
  db: typeof import('@ybot/db').prisma,
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
