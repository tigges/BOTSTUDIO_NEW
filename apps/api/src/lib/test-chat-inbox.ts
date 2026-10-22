/**
 * A test chat that reaches a person. Journey Test and Test Bot keep their chat in
 * memory, but when the turn pipeline hands over and live support is on, the chat
 * becomes a real Sandbox chat in the Inbox so someone can pick it up. Its later
 * lines are mirrored there, and the person's replies come back to the test panel.
 *
 * Sandbox only: production numbers never see it.
 */

import { prisma } from '@botstudio/db'
import type { HandoverContract, HandoverRequest } from '@botstudio/shared'
import { handOverChat, isHeld } from './handover.js'
import { broadcastToTenant } from '../ws.js'

export const TEST_CHAT_SUBJECT = 'Journey Test'

export interface TestInboxPort {
  /** Creates the Sandbox chat with the transcript so far and hands it over. Null when the bot has no Sandbox. */
  open(input: {
    tenantId: string
    botId: string
    transcript: Array<{ role: 'user' | 'assistant'; content: string }>
    request: HandoverRequest
    source: HandoverContract['source']
    subject: string | null
  }): Promise<string | null>
  /** Whether a person still holds the chat; null when it is gone. */
  status(conversationId: string): Promise<{ held: boolean; status: string } | null>
  /** A line said in the test panel after the handover. */
  mirror(input: { tenantId: string; conversationId: string; role: 'user' | 'assistant'; text: string }): Promise<void>
}

export const liveTestInbox: TestInboxPort = {
  async open(input) {
    const sandbox = await prisma.environment.findFirst({
      where: { botId: input.botId, tenantId: input.tenantId, kind: 'sandbox' },
      select: { id: true },
    })
    if (!sandbox) return null
    const chat = await prisma.conversation.create({
      data: {
        tenantId: input.tenantId,
        botId: input.botId,
        environmentId: sandbox.id,
        status: 'active',
        subject: input.subject ? `${TEST_CHAT_SUBJECT}: ${input.subject}` : TEST_CHAT_SUBJECT,
      },
    })
    const start = Date.now() - input.transcript.length * 1000
    await prisma.message.createMany({
      data: input.transcript
        .filter((line) => line.content.trim())
        .map((line, index) => ({
          tenantId: input.tenantId,
          conversationId: chat.id,
          direction: line.role === 'user' ? 'inbound' : 'outbound',
          authorKind: line.role === 'user' ? 'user' : 'bot',
          content: { text: line.content },
          createdAt: new Date(start + index * 1000),
        })),
    })
    await handOverChat({ conversationId: chat.id, tenantId: input.tenantId, botId: input.botId, request: input.request, source: input.source })
    broadcastToTenant(input.tenantId, { event: 'conversation.created', data: { ...chat, status: 'escalated' } })
    return chat.id
  },
  async status(conversationId) {
    const chat = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { status: true, assignedTo: true } }).catch(() => null)
    return chat ? { held: isHeld(chat), status: chat.status } : null
  },
  async mirror(input) {
    if (!input.text.trim()) return
    await prisma.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        direction: input.role === 'user' ? 'inbound' : 'outbound',
        authorKind: input.role === 'user' ? 'user' : 'bot',
        content: { text: input.text },
      },
    })
    await prisma.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }).catch(() => {})
  },
}

export interface TestInboxReply {
  id: string
  text: string
  at: string
}

/** What the team said in the Inbox after `after`, and whether they still hold the chat. */
export async function testInboxReplies(tenantId: string, botId: string, conversationId: string, after: Date | null) {
  const chat = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId, botId },
    select: { status: true, assignedTo: true },
  })
  if (!chat) return null
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      direction: 'outbound',
      authorKind: 'agent',
      ...(after ? { createdAt: { gt: after } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true, content: true, createdAt: true },
  })
  const replies: TestInboxReply[] = rows.flatMap((row) => {
    const content = row.content as { text?: unknown; internal?: unknown } | null
    if (!content || content.internal === true || typeof content.text !== 'string' || !content.text.trim()) return []
    return [{ id: row.id, text: content.text, at: row.createdAt.toISOString() }]
  })
  return { held: isHeld(chat), status: chat.status, replies }
}
