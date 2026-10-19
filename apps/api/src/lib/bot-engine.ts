/**
 * Shared bot response engine.
 *
 * Used by channels that cannot use SSE streaming (WhatsApp, SMS, etc.).
 * The web widget uses its own streaming pipeline in widget.ts.
 */

import { prisma } from '@ybot/db'
import { onInboundCustomerMessage, onOutboundReply } from './sla.js'
import { finishBotLines, saveContactName, takeNameTurn } from './visitor-name.js'
import { fillNameTokens } from '@ybot/shared'
import { createLlmAdapter, createLlmAdapterForModel, createEmbeddingAdapter } from '@ybot/llm'
import type { LlmMessage } from '@ybot/llm'
import { runFlowIfPublished } from './flow-runner.js'
import { conversationScope, enterLlmScope, withLlmScope } from './llm-ledger.js'

const llm = createLlmAdapter()
const embedAI = createEmbeddingAdapter()

async function ragSearch(query: string, tenantId: string, botId: string, topK = 4): Promise<string[]> {
  try {
    const r = await embedAI.embed({ texts: [query] })
    const vec = r.embeddings[0]
    if (!vec || vec.length === 0) return []
    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<Array<{ content: string }>>)(
      `SELECT dc.content
       FROM "document_chunks" dc
       JOIN "documents" d ON dc."documentId" = d.id
       WHERE d."botId" = $1 AND d."tenantId" = $2
       ORDER BY dc.embedding <-> $3::vector
       LIMIT $4`,
      botId, tenantId, JSON.stringify(vec), topK,
    )
    return rows.map((r) => r.content)
  } catch {
    return []
  }
}

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
  /** Optional prior message history */
  history?: Array<{ role: string; content: string }>
}

export interface BotReplyResult {
  reply: string
  conversationId: string | null
}

/**
 * Run the full RAG + LLM pipeline and return the complete bot reply.
 * Creates/upserts Contact and Conversation records as needed.
 */
export async function getBotReply(params: BotReplyParams): Promise<BotReplyResult> {
  return withLlmScope({ source: 'runtime', tenantId: params.tenantId, botId: params.botId }, () => replyFor(params))
}

async function replyFor(params: BotReplyParams): Promise<BotReplyResult> {
  const { channelId, botId, tenantId, userText, externalId, conversationId: incomingConvoId, history = [] } = params

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, isActive: true },
    include: { bot: true },
  })
  if (!channel?.bot) throw new Error('Channel not found or inactive')

  const bot = channel.bot

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
      const convo = await prisma.conversation.create({
        data: { tenantId, botId, environmentId: env.id, channelId, contactId: contact.id, status: 'active' },
      })
      conversationId = convo.id
    }
  }

  // ── Save inbound message ──────────────────────────────────────────────────
  if (conversationId) {
    enterLlmScope(await conversationScope(conversationId))
    await prisma.message.create({
      data: { tenantId, conversationId, direction: 'inbound', authorKind: 'user', content: { text: userText } },
    }).catch(() => {})

    // Working hours start the SLA clock. The bot still answers.
    await onInboundCustomerMessage({ conversationId, botId }).catch(() => null)
  }

  const named = conversationId ? await takeNameTurn(conversationId, userText) : null
  if (named?.thanks && conversationId) {
    await prisma.message.create({
      data: { tenantId, conversationId, direction: 'outbound', authorKind: 'bot', content: { text: named.thanks } },
    }).catch(() => {})
    await onOutboundReply(conversationId).catch(() => {})
    return { reply: named.thanks, conversationId }
  }

  if (conversationId) {
    try {
      const flow = await runFlowIfPublished({ conversationId, botId, tenantId, userText })
      if (flow.handled && flow.messages.some((line) => line.trim())) {
        const reply = flow.messages.join('\n\n')
        const finished = named
          ? finishBotLines([fillNameTokens(reply, named.spoken)], named.contact, named.spoken, {
            conversationId,
          }).lines.join('\n\n')
          : reply
        await prisma.message.create({
          data: { tenantId, conversationId, direction: 'outbound', authorKind: 'bot', content: { text: finished } },
        }).catch(() => {})
        await onOutboundReply(conversationId).catch(() => {})
        return { reply: finished, conversationId }
      }
    } catch (err) {
      console.error('[bot-engine] flow runner error — falling back to RAG:', err)
    }
  }

  // ── LLM config ────────────────────────────────────────────────────────────
  const cfg = await prisma.botConfig.findUnique({ where: { botId } }).catch(() => null)
  const systemPromptBase = cfg?.systemPrompt ?? `You are a helpful assistant for ${bot.name}. Answer using the knowledge base context.`
  const model = cfg?.model ?? undefined
  const temperature = cfg?.temperature ?? 0.3
  const maxTokens = cfg?.maxTokens ?? 2048

  // ── RAG ───────────────────────────────────────────────────────────────────
  const ragChunks = await ragSearch(userText, tenantId, botId)
  const contextBlock = ragChunks.length > 0
    ? `\n\n--- KNOWLEDGE BASE ---\n${ragChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}\n--- END KNOWLEDGE BASE ---\n\nAnswer using only this context. If unknown, say so.`
    : ''

  // ── History ───────────────────────────────────────────────────────────────
  const messages: LlmMessage[] = [
    ...history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userText },
  ]

  // ── Complete (non-streaming) ──────────────────────────────────────────────
  let reply = ''
  try {
    const adapter = model ? createLlmAdapterForModel(model) : llm
    const result = await adapter.complete({
      messages,
      systemPrompt: systemPromptBase + contextBlock,
      model,
      temperature,
      maxTokens,
    })
    reply = result.content ?? ''
  } catch (err) {
    console.error('[bot-engine] LLM error:', err)
    reply = "I'm sorry, something went wrong. Please try again."
  }

  if (named) {
    const finished = finishBotLines([fillNameTokens(reply, named.spoken)], named.contact, named.spoken, {
      conversationId: conversationId ?? undefined,
    })
    reply = finished.lines.join('\n\n')
    if (named.contact?.id && finished.metadata) {
      await saveContactName(named.contact.id, { metadata: finished.metadata }).catch(() => {})
    }
  }

  // ── Save bot reply ────────────────────────────────────────────────────────
  if (conversationId && reply.trim()) {
    await prisma.message.create({
      data: { tenantId, conversationId, direction: 'outbound', authorKind: 'bot', content: { text: reply } },
    }).catch(() => {})
    await onOutboundReply(conversationId).catch(() => {})
  }

  return { reply, conversationId }
}
