/**
 * A guest line posted through the Inbox API runs the same turn as the widget and channels.
 * Reply text streams to the Inbox as message.chunk; the saved reply arrives as message.created.
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '@ybot/db'
import { runTurn } from './lib/turn-pipeline.js'

export async function processInboundMessage(
  app: FastifyInstance,
  conversationId: string,
  tenantId: string,
  incomingText: string,
): Promise<void> {
  try {
    const convo = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { botId: true } })
    if (!convo) return
    await runTurn({
      conversationId,
      tenantId,
      botId: convo.botId,
      text: incomingText,
      inboundSaved: true,
      onChunk: (chunk) => app.broadcastToTenant(tenantId, { event: 'message.chunk', data: { conversationId, chunk } }),
    })
  } catch (err) {
    app.log.error({ err, conversationId }, 'Inbox turn failed')
  }
}
