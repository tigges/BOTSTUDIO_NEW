/**
 * A guest line posted through the Inbox API runs the same turn as the widget and channels.
 * Reply text streams to the Inbox as message.chunk; the saved reply arrives as message.created.
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '@botstudio/db'
import { readerMode } from '@botstudio/shared'
import { loadPrivacy } from './lib/privacy.js'
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
    const agentsSeeOriginal = readerMode(await loadPrivacy(convo.botId), 'human_agent') === 'original'
    await runTurn({
      conversationId,
      tenantId,
      botId: convo.botId,
      text: incomingText,
      inboundSaved: true,
      // A half-written personal detail cannot be masked, so masked bots send the saved reply only.
      onChunk: agentsSeeOriginal
        ? (chunk) => app.broadcastToTenant(tenantId, { event: 'message.chunk', data: { conversationId, chunk } })
        : undefined,
    })
  } catch (err) {
    app.log.error({ err, conversationId }, 'Inbox turn failed')
  }
}
