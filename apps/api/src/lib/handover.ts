/**
 * Handing a chat to a person and taking it back.
 *
 * The chat itself is the task: the contract is saved on the conversation and the
 * Inbox shows it in the chat header. While a person holds a chat the bot stays quiet.
 * Opening hours decide whether anyone is there to take it (see chat-outcome.ts).
 */

import { prisma } from '@ybot/db'
import {
  handoverSummary,
  type HandoverContract,
  type HandoverRequest,
  type HandoverReturn,
  type ReturnOutcome,
} from '@ybot/shared'
import { dispatchWebhookEvent } from '../queues.js'
import { triggerRules } from './automation-engine.js'
import { hasLiveAgentHours } from './chat-outcome.js'
import { sendChannelReply } from './channel-outbound.js'
import { parseInboxPolicy } from './sla.js'

export const HANDOVER_LINE = 'I am passing this chat to the team. Someone will continue here.'

/** Channels where a person's reply is sent on by the platform. The website widget fetches it instead. */
const PUSH_CHANNELS = new Set(['whatsapp', 'telegram', 'sms', 'email'])

export interface HandoverRules {
  liveAgents: boolean
  alwaysHuman: string[]
}

export async function handoverRulesFor(botId: string): Promise<HandoverRules> {
  const cfg = await prisma.botConfig.findUnique({ where: { botId }, select: { inboxConfig: true } }).catch(() => null)
  return {
    liveAgents: hasLiveAgentHours(cfg?.inboxConfig),
    alwaysHuman: parseInboxPolicy(cfg?.inboxConfig).alwaysHuman,
  }
}

/** A person holds an open chat once it is escalated or someone is assigned. A closed chat is nobody's. */
export function isHeld(chat: { status: string; assignedTo: string | null } | null | undefined): boolean {
  if (!chat) return false
  return chat.status === 'escalated' || (chat.status === 'active' && Boolean(chat.assignedTo))
}

export async function chatIsHeld(conversationId: string): Promise<boolean> {
  const chat = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true, assignedTo: true },
  }).catch(() => null)
  return isHeld(chat)
}

function lineText(content: unknown): { text: string; internal: boolean } {
  const row = content && typeof content === 'object' ? content as { text?: unknown; internal?: unknown } : {}
  return { text: typeof row.text === 'string' ? row.text : '', internal: row.internal === true }
}

async function transcriptOf(conversationId: string) {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { direction: true, authorKind: true, content: true, createdAt: true },
    take: 500,
  }).catch(() => [])
  return rows.flatMap((row) => {
    const line = lineText(row.content)
    if (line.internal || !line.text.trim()) return []
    return [{ from: row.authorKind, direction: row.direction, text: line.text, at: row.createdAt.toISOString() }]
  })
}

/** Saves the contract, marks the chat escalated and tells rules and webhooks. */
export async function handOverChat(opts: {
  conversationId: string
  tenantId: string
  botId: string
  request: HandoverRequest
  source: HandoverContract['source']
  now?: Date
}): Promise<HandoverContract> {
  const transcript = await transcriptOf(opts.conversationId)
  const guestLines = transcript.filter((line) => line.direction === 'inbound').map((line) => line.text)
  const contract: HandoverContract = {
    ...opts.request,
    summary: opts.request.summary || handoverSummary(guestLines, opts.request.variables),
    at: (opts.now ?? new Date()).toISOString(),
    source: opts.source,
  }
  await prisma.conversation.update({
    where: { id: opts.conversationId },
    data: { status: 'escalated', outcome: 'escalated', handover: contract as object, updatedAt: new Date() },
  }).catch(() => {})
  triggerRules('conversation.escalated', {
    tenantId: opts.tenantId,
    botId: opts.botId,
    conversationId: opts.conversationId,
    conversationStatus: 'escalated',
    messageCount: guestLines.length,
  }).catch(() => {})
  dispatchWebhookEvent(opts.tenantId, 'conversation.escalated', {
    conversationId: opts.conversationId,
    botId: opts.botId,
    handover: contract,
    ...(contract.context === 'full_transcript' ? { transcript } : {}),
  }).catch(() => {})
  return contract
}

export function ticketPriority(priority: string | undefined): string {
  return priority === 'critical' ? 'urgent' : priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'medium'
}

/** The chat fields a hand-back sets. Escalation stays recorded whatever the outcome. */
export function returnChange(outcome: ReturnOutcome, at: Date) {
  if (outcome === 'needs_bot') return { status: 'active', assignedTo: null, resolvedAt: null, outcome: 'escalated' }
  if (outcome === 'needs_follow_up') return { status: 'closed', resolvedAt: at, outcome: 'escalated' }
  return { status: 'resolved', resolvedAt: at, outcome: 'escalated' }
}

/** A person hands the chat back: resolved, back to the bot, or closed with a follow-up ticket. */
export async function returnChat(opts: {
  conversationId: string
  tenantId: string
  outcome: ReturnOutcome
  note?: string
  userId?: string
  now?: Date
}): Promise<{ handover: Record<string, unknown>; ticketId?: string } | null> {
  const chat = await prisma.conversation.findFirst({
    where: { id: opts.conversationId, tenantId: opts.tenantId },
    select: { id: true, botId: true, handover: true },
  })
  if (!chat) return null
  const at = opts.now ?? new Date()
  const note = opts.note?.trim().slice(0, 1000) || undefined
  const returned: HandoverReturn = { outcome: opts.outcome, at: at.toISOString(), ...(note ? { note } : {}), ...(opts.userId ? { by: opts.userId } : {}) }
  const previous = chat.handover && typeof chat.handover === 'object' ? chat.handover as Partial<HandoverContract> : {}
  const handover = { ...previous, returned }

  let ticketId: string | undefined
  if (opts.outcome === 'needs_follow_up') {
    const reason = previous.reason ?? 'Follow up with the guest'
    const ticket = await prisma.ticket.create({
      data: {
        tenantId: opts.tenantId,
        conversationId: chat.id,
        subject: `Follow up: ${reason}`.slice(0, 180),
        description: [previous.summary, note].filter(Boolean).join('\n\n').slice(0, 2000) || reason,
        status: 'open',
        priority: ticketPriority(previous.priority),
      },
    })
    ticketId = ticket.id
  }
  if (opts.outcome === 'needs_bot') {
    await prisma.flowSession.deleteMany({ where: { conversationId: chat.id } }).catch(() => {})
  }
  await prisma.conversation.update({
    where: { id: chat.id },
    data: { ...returnChange(opts.outcome, at), handover: handover as object },
  })
  if (opts.outcome === 'resolved') {
    triggerRules('conversation.resolved', {
      tenantId: opts.tenantId,
      botId: chat.botId,
      conversationId: chat.id,
      conversationStatus: 'resolved',
    }).catch(() => {})
  }
  return { handover, ...(ticketId ? { ticketId } : {}) }
}

/**
 * Sends a person's Inbox reply to the guest on their messaging channel.
 * 'widget' means the website widget picks it up on its next check.
 */
export async function deliverAgentReply(conversationId: string, text: string): Promise<'sent' | 'widget' | 'none'> {
  const chat = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { channel: { select: { kind: true, config: true, isActive: true } }, contact: { select: { externalId: true } } },
  })
  const kind = chat?.channel?.kind
  if (!kind) return 'none'
  if (kind === 'web') return 'widget'
  const to = chat?.contact?.externalId
  if (!PUSH_CHANNELS.has(kind) || !to || !chat?.channel?.isActive) return 'none'
  await sendChannelReply(kind, chat.channel.config, to, text)
  return 'sent'
}
