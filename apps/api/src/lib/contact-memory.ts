/**
 * Contact memory in Postgres. The journey recalls a contact's facts into
 * contact.* when a chat starts and remembers the bot's listed answers after
 * every turn. Values are stored as given; every reader renders them through
 * its privacy mode, and model calls see them tokenised like any other text.
 */
import { prisma } from '@ybot/db'
import { factsToRemember, memoryExpiry, parseMemorySettings, recallFacts, type MemorySettings } from '@ybot/shared'

const DAY = 86_400_000

export async function memorySettings(botId: string): Promise<MemorySettings> {
  const row = await prisma.botConfig.findUnique({ where: { botId }, select: { memory: true } }).catch(() => null)
  return parseMemorySettings(row?.memory)
}

async function contactOf(conversationId: string): Promise<{ contactId: string; tenantId: string } | null> {
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { contactId: true, tenantId: true } })
  return convo?.contactId ? { contactId: convo.contactId, tenantId: convo.tenantId } : null
}

export async function recallForChat(conversationId: string, botId: string, now = new Date()): Promise<Record<string, string>> {
  const settings = await memorySettings(botId)
  if (!settings.enabled) return {}
  const owner = await contactOf(conversationId)
  if (!owner) return {}
  const rows = await prisma.contactMemory.findMany({
    where: { contactId: owner.contactId, key: { in: settings.keys } },
    select: { key: true, value: true, expiresAt: true },
  })
  return recallFacts(settings, rows, now)
}

export interface MemoryWrite {
  key: string
  value: string
  expiresAt: Date
  /** create: new fact; update: new value or refreshed expiry. */
  op: 'create' | 'update'
}

/** Which facts to write. Unchanged values only refresh their expiry once a day. */
export function memoryWrites(
  settings: MemorySettings,
  flow: Record<string, unknown>,
  existing: Array<{ key: string; value: string; updatedAt: Date }>,
  now: Date,
): MemoryWrite[] {
  const known = new Map(existing.map((row) => [row.key, row]))
  const writes: MemoryWrite[] = []
  for (const fact of factsToRemember(settings, flow)) {
    const before = known.get(fact.key)
    if (before && before.value === fact.value && now.getTime() - before.updatedAt.getTime() < DAY) continue
    writes.push({ ...fact, expiresAt: memoryExpiry(settings, now), op: before ? 'update' : 'create' })
  }
  return writes
}

export async function rememberFromChat(conversationId: string, botId: string, flow: Record<string, unknown>, now = new Date()): Promise<number> {
  const settings = await memorySettings(botId)
  if (!settings.enabled) return 0
  if (factsToRemember(settings, flow).length === 0) return 0
  const owner = await contactOf(conversationId)
  if (!owner) return 0
  const existing = await prisma.contactMemory.findMany({
    where: { contactId: owner.contactId, key: { in: settings.keys } },
    select: { key: true, value: true, updatedAt: true },
  })
  const writes = memoryWrites(settings, flow, existing, now)
  for (const write of writes) {
    await prisma.contactMemory.upsert({
      where: { contactId_key: { contactId: owner.contactId, key: write.key } },
      create: { tenantId: owner.tenantId, contactId: owner.contactId, key: write.key, value: write.value, botId, conversationId, expiresAt: write.expiresAt },
      update: { value: write.value, botId, conversationId, expiresAt: write.expiresAt },
    })
  }
  return writes.length
}

/** Expired facts are never recalled; this removes them from storage too. */
export async function sweepExpiredMemory(now = new Date()): Promise<number> {
  const result = await prisma.contactMemory.deleteMany({ where: { expiresAt: { lte: now } } })
  return result.count
}
