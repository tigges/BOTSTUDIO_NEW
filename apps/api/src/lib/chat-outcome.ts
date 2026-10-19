/**
 * Who closes a chat.
 *
 * The bot resolves every chat unless the bot has opening hours for live agents.
 * Without opening hours nobody watches the queue, so a handover stays with the bot.
 * A chat the bot finishes, or one where the guest goes quiet after the bot's reply,
 * is resolved by the bot. Chats a person holds are never closed here.
 */

import { prisma } from '@ybot/db'
import { parseInboxPolicy } from './sla.js'

export const QUIET_MINUTES = 30

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

export async function liveAgentsFor(botId: string): Promise<boolean> {
  const cfg = await prisma.botConfig.findUnique({ where: { botId }, select: { inboxConfig: true } }).catch(() => null)
  return hasLiveAgentHours(cfg?.inboxConfig)
}

/** The bot reached the end of the journey. Only an open chat nobody holds is closed. */
export async function resolveByBot(conversationId: string, at = new Date()): Promise<boolean> {
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, status: 'active', assignedTo: null },
    data: { status: 'resolved', resolvedAt: at },
  }).catch(() => ({ count: 0 }))
  return result.count === 1
}

/** The guest wrote again after the chat closed, so the bot holds it open until the next close. */
export async function reopenForBot(conversationId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, status: 'resolved', assignedTo: null },
    data: { status: 'active', resolvedAt: null },
  }).catch(() => {})
}

/** A chat where the bot spoke last and the guest stayed quiet for QUIET_MINUTES. */
export const QUIET_CHATS_SQL = `
  UPDATE conversations c
     SET status = 'resolved', "resolvedAt" = last."createdAt", "updatedAt" = NOW()
    FROM (
      SELECT DISTINCT ON ("conversationId") "conversationId", "authorKind", "createdAt"
        FROM messages
       ORDER BY "conversationId", "createdAt" DESC
    ) last
   WHERE last."conversationId" = c.id
     AND c.status = 'active'
     AND c."assignedTo" IS NULL
     AND last."authorKind" = 'bot'
     AND last."createdAt" < $1`

export async function resolveQuietChats(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - QUIET_MINUTES * 60 * 1000)
  return prisma.$executeRawUnsafe(QUIET_CHATS_SQL, before)
}

export function startQuietChatSweep(log: (message: string) => void, everyMs = 5 * 60 * 1000): () => void {
  const sweep = () => {
    resolveQuietChats()
      .then((count) => { if (count > 0) log(`[chat-outcome] resolved ${count} quiet ${count === 1 ? 'chat' : 'chats'} by the bot`) })
      .catch((err) => log(`[chat-outcome] sweep failed: ${err instanceof Error ? err.message : String(err)}`))
  }
  sweep()
  const timer = setInterval(sweep, everyMs)
  timer.unref()
  return () => clearInterval(timer)
}
