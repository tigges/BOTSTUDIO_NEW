/**
 * Who closes a chat.
 *
 * The bot resolves every chat unless the bot has opening hours for live agents.
 * Without opening hours nobody watches the queue, so a handover stays with the bot.
 * A chat the bot finishes, or one where the guest goes quiet after the bot's reply,
 * is resolved by the bot. Chats a person holds are never closed here.
 *
 * Every closed chat also gets an outcome. Escalation is recorded when it happens,
 * never inferred from what is left after containment.
 */

import { prisma } from '@ybot/db'
import { parseInboxPolicy } from './sla.js'

export const QUIET_MINUTES = 30

export const CHAT_OUTCOMES = ['contained_resolved', 'contained_partial', 'contained_unresolved', 'escalated', 'abandoned'] as const
export type ChatOutcome = typeof CHAT_OUTCOMES[number]

export const NO_TEAM_LINE = 'The team is not on chat, so I will keep helping here. What do you need help with?'

const HANDOVER_PROMISE = /\b(?:passing|handing|hand) (?:this|the|you|your) (?:chat|conversation)\b|\bsomeone will continue here\b|\bwill pick up (?:the|this) chat\b|\bconnecting you (?:to|with)\b/i

/** True once someone saved opening hours for live agents on this bot. */
export function hasLiveAgentHours(inboxConfig: unknown): boolean {
  return parseInboxPolicy(inboxConfig).workingHours.enabled
}

/** Drops "I am passing this chat to the team" sentences and closes with the no-team line. */
export function keepWithBot(lines: string[]): string[] {
  const kept = lines.flatMap((line) => {
    const sentences = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line]
    const left = sentences.filter((sentence) => !HANDOVER_PROMISE.test(sentence)).join('').trim()
    return left ? [left] : []
  })
  return [...kept, NO_TEAM_LINE]
}

/**
 * The bot reached the end of the journey. Only an open chat nobody holds is closed.
 * A chat a person handed back to the bot stays recorded as escalated.
 */
export async function resolveByBot(conversationId: string, at = new Date()): Promise<boolean> {
  const open = { id: conversationId, status: 'active', assignedTo: null }
  const contained = await prisma.conversation.updateMany({
    where: { ...open, OR: [{ outcome: null }, { outcome: { not: 'escalated' } }] },
    data: { status: 'resolved', resolvedAt: at, outcome: 'contained_resolved' },
  }).catch(() => ({ count: 0 }))
  if (contained.count === 1) return true
  const escalated = await prisma.conversation.updateMany({
    where: { ...open, outcome: 'escalated' },
    data: { status: 'resolved', resolvedAt: at },
  }).catch(() => ({ count: 0 }))
  return escalated.count === 1
}

/**
 * The outcome after a person changes a chat's status in the Inbox.
 * undefined leaves it unchanged; a chat someone holds counts as escalated.
 */
export function outcomeAfterStatus(
  status: string | undefined,
  assignedTo: string | null,
  current: string | null,
): ChatOutcome | null | undefined {
  if (status === 'escalated') return 'escalated'
  if (status === 'active') return null
  if (status === 'resolved' || status === 'closed') {
    if (assignedTo) return 'escalated'
    return (current as ChatOutcome | null) ?? 'contained_resolved'
  }
  return undefined
}

/** The guest asked for a person and nobody is on chat. Kept unless the bot later finishes the journey. */
export async function markNoTeam(conversationId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, outcome: null },
    data: { outcome: 'contained_unresolved' },
  }).catch(() => {})
}

/** The guest wrote again after the chat closed, so the bot holds it open until the next close. */
export async function reopenForBot(conversationId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, status: { in: ['resolved', 'closed'] }, assignedTo: null, outcome: { not: 'escalated' } },
    data: { status: 'active', resolvedAt: null, outcome: null },
  }).catch(() => {})
}

/**
 * Open chats nobody holds where nothing happened for QUIET_MINUTES.
 * Bot spoke last: resolved, or partial when the guest left mid-question (not the "Anything else" ask).
 * The guest never typed: abandoned. The guest spoke last and got no answer: unresolved.
 * An outcome set earlier (the guest asked for a person and nobody was on chat) is kept.
 */
export const QUIET_CHATS_SQL = `
  WITH last AS (
    SELECT DISTINCT ON ("conversationId") "conversationId", "authorKind", "createdAt"
      FROM messages
     ORDER BY "conversationId", "createdAt" DESC
  ), quiet AS (
    SELECT c.id, last."createdAt" AS at,
           COALESCE(c.outcome, CASE
             WHEN last."authorKind" = 'user' THEN 'contained_unresolved'
             WHEN NOT EXISTS (
               SELECT 1 FROM messages m WHERE m."conversationId" = c.id AND m.direction = 'inbound'
             ) THEN 'abandoned'
             WHEN EXISTS (
               SELECT 1 FROM flow_sessions fs
                WHERE fs."conversationId" = c.id
                  AND fs.status = 'waiting_input'
                  AND COALESCE(fs."waitingFor"->>'variable', '') <> 'request'
             ) THEN 'contained_partial'
             ELSE 'contained_resolved'
           END) AS outcome
      FROM conversations c
      JOIN last ON last."conversationId" = c.id
     WHERE c.status = 'active'
       AND c."assignedTo" IS NULL
       AND last."authorKind" IN ('bot', 'user')
       AND last."createdAt" < $1
  )
  UPDATE conversations c
     SET status = CASE WHEN quiet.outcome IN ('contained_resolved', 'contained_partial') THEN 'resolved' ELSE 'closed' END,
         outcome = quiet.outcome,
         "resolvedAt" = quiet.at,
         "updatedAt" = NOW()
    FROM quiet
   WHERE quiet.id = c.id`

/** Closed chats from before outcomes existed. Idempotent; the migration does the same once. */
export const BACKFILL_OUTCOMES_SQL = `
  UPDATE conversations
     SET outcome = CASE
       WHEN status = 'escalated' OR "assignedTo" IS NOT NULL THEN 'escalated'
       ELSE 'contained_resolved'
     END
   WHERE outcome IS NULL
     AND (status IN ('resolved', 'closed', 'escalated'))`

export async function resolveQuietChats(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - QUIET_MINUTES * 60 * 1000)
  return prisma.$executeRawUnsafe(QUIET_CHATS_SQL, before)
}

export function startQuietChatSweep(log: (message: string) => void, everyMs = 5 * 60 * 1000): () => void {
  prisma.$executeRawUnsafe(BACKFILL_OUTCOMES_SQL)
    .then((count) => { if (count > 0) log(`[chat-outcome] recorded outcomes for ${count} earlier chats`) })
    .catch((err) => log(`[chat-outcome] outcome backfill failed: ${err instanceof Error ? err.message : String(err)}`))
  const sweep = () => {
    resolveQuietChats()
      .then((count) => { if (count > 0) log(`[chat-outcome] closed ${count} quiet ${count === 1 ? 'chat' : 'chats'}`) })
      .catch((err) => log(`[chat-outcome] sweep failed: ${err instanceof Error ? err.message : String(err)}`))
  }
  sweep()
  const timer = setInterval(sweep, everyMs)
  timer.unref()
  return () => clearInterval(timer)
}
