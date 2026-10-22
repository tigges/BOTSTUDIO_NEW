/**
 * Messaging channels (WhatsApp, Telegram, SMS, email): find or open the chat, then run one turn.
 * The reply is returned whole because these channels do not stream.
 */

import { prisma } from '@botstudio/db'
import { withLlmScope } from './llm-ledger.js'
import { runTurn } from './turn-pipeline.js'

/**
 * A message within this many hours of the last one continues the same chat on a channel,
 * including one a person holds. A chat a person already closed is not reopened.
 */
export const CHANNEL_CHAT_HOURS = 24

export interface BotReplyParams {
  channelId: string
  botId: string
  tenantId: string
  userText: string
  /** Stable external identifier for the sender (e.g. WhatsApp phone number, session ID) */
  externalId: string
  /** Not used to open a chat. A profile or earlier name stays off the first line. */
  displayName?: string
  /** Optional existing conversation ID */
  conversationId?: string | null
}

export interface BotReplyResult {
  reply: string
  conversationId: string | null
  /** The open question's choices; channels show them as buttons, a menu or a numbered list. */
  choices?: string[]
}

/** Creates the contact and chat when needed, then runs the shared turn pipeline. */
export async function getBotReply(params: BotReplyParams): Promise<BotReplyResult> {
  return withLlmScope({ source: 'runtime', tenantId: params.tenantId, botId: params.botId }, () => replyFor(params))
}

async function replyFor(params: BotReplyParams): Promise<BotReplyResult> {
  const { channelId, botId, tenantId, userText, externalId, conversationId: incomingConvoId } = params

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, isActive: true },
    include: { bot: true },
  })
  if (!channel?.bot) throw new Error('Channel not found or inactive')

  // ── Conversation resolution ───────────────────────────────────────────────
  let conversationId: string | null = incomingConvoId ?? null
  if (conversationId) {
    const exists = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId, channelId } })
    if (!exists) conversationId = null
  }

  if (!conversationId) {
    const env = await prisma.environment.findFirst({ where: { botId } })
    if (env) {
      let contact = await prisma.contact.findFirst({ where: { tenantId, externalId } })
      if (!contact) {
        contact = await prisma.contact.create({
          data: { tenantId, externalId, displayName: 'Visitor', channelId },
        })
      }
      const recent = await prisma.conversation.findFirst({
        where: {
          tenantId,
          channelId,
          contactId: contact.id,
          OR: [
            { status: { in: ['active', 'escalated'] } },
            { status: { in: ['resolved', 'closed'] }, outcome: { not: 'escalated' } },
          ],
          updatedAt: { gte: new Date(Date.now() - CHANNEL_CHAT_HOURS * 60 * 60 * 1000) },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
      conversationId = recent?.id ?? (await prisma.conversation.create({
        data: { tenantId, botId, environmentId: env.id, channelId, contactId: contact.id, status: 'active' },
      })).id
    }
  }

  if (!conversationId) return { reply: 'This chat is not set up yet. Please try again later.', conversationId: null }

  const turn = await runTurn({ conversationId, tenantId, botId, text: userText })
  return { reply: turn.text, conversationId, ...(turn.choices?.length ? { choices: turn.choices } : {}) }
}
