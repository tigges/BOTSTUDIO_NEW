import { prisma } from '@botstudio/db'

export type TestRunFilter = 'include' | 'exclude' | 'only'

export interface InboxListQuery {
  botId?: string
  status?: string
  assignedTo?: string
  channelId?: string
  contactId?: string
  /** Words in the contact's name, email or phone, or in any message. */
  search?: string
  testRuns: TestRunFilter
  sort: 'newest' | 'oldest'
}

const MAX_SEARCH = 100

export function readInboxQuery(raw: Record<string, string | undefined>): InboxListQuery {
  const text = (raw['q'] ?? '').trim().slice(0, MAX_SEARCH)
  const testRuns = raw['testRuns'] === 'exclude' || raw['testRuns'] === 'only' ? raw['testRuns'] : 'include'
  return {
    ...(raw['botId'] ? { botId: raw['botId'] } : {}),
    ...(raw['status'] ? { status: raw['status'] } : {}),
    ...(raw['assignedTo'] ? { assignedTo: raw['assignedTo'] } : {}),
    ...(raw['channelId'] ? { channelId: raw['channelId'] } : {}),
    ...(raw['contactId'] ? { contactId: raw['contactId'] } : {}),
    ...(text ? { search: text } : {}),
    testRuns,
    sort: raw['sort'] === 'oldest' ? 'oldest' : 'newest',
  }
}

/** `%text%` for ILIKE, with the wildcard characters a person typed taken literally. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * The Prisma filter for one Inbox list. `messageMatches` are the chats whose
 * messages contain the search words (found with one ILIKE query beforehand).
 */
export function inboxWhere(tenantId: string, query: InboxListQuery, messageMatches: string[] = []) {
  const search = query.search
  return {
    tenantId,
    ...(query.botId ? { botId: query.botId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
    ...(query.channelId ? { channelId: query.channelId } : {}),
    ...(query.contactId ? { contactId: query.contactId } : {}),
    ...(query.testRuns === 'exclude' ? { testRunId: null } : query.testRuns === 'only' ? { testRunId: { not: null } } : {}),
    ...(search
      ? {
          OR: [
            { contact: { displayName: { contains: search, mode: 'insensitive' as const } } },
            { contact: { email: { contains: search, mode: 'insensitive' as const } } },
            { contact: { phone: { contains: search } } },
            ...(messageMatches.length ? [{ id: { in: messageMatches } }] : []),
          ],
        }
      : {}),
  }
}

export async function chatsWithMessagesLike(tenantId: string, search: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ conversationId: string }>>(
    `SELECT DISTINCT "conversationId" FROM "messages" WHERE "tenantId" = $1 AND content->>'text' ILIKE $2 LIMIT 500`,
    tenantId,
    likePattern(search),
  ).catch(() => [])
  return rows.map((row) => row.conversationId)
}
