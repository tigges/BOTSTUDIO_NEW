/**
 * Runtime bridge: handles inbound messages and runs the SessionMachine OR
 * falls back to a direct RAG → Claude path when no published flow exists.
 *
 * Direct LLM mode (no published flow):
 *  1. Load per-bot LLM config (model, temperature, systemPrompt) from BotConfig
 *  2. Load last 10 messages for multi-turn conversation memory
 *  3. Embed user message → pgvector cosine search for RAG context
 *  4. Stream ragComplete() — each chunk broadcast as message.chunk over WS
 *  5. Save complete message → broadcast message.created
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '@ybot/db'
import { SessionMachine } from '@ybot/runtime'
import type { Session, ExecutionServices } from '@ybot/runtime'
import { createLlmAdapter, createEmbeddingAdapter } from '@ybot/llm'
import type { LlmMessage } from '@ybot/llm'
import { fillNameTokens } from '@ybot/shared'
import { finishBotLines, saveContactName, takeNameTurn, type NamePlan, type VisitorName } from './lib/visitor-name.js'
import { keepWithBot, liveAgentsFor, reopenForBot, resolveByBot } from './lib/chat-outcome.js'

const llm = createLlmAdapter()
const embedAdapter = createEmbeddingAdapter()

// ── Redis / session helpers ───────────────────────────────────────────────────
let redisClient: import('ioredis').Redis | null = null
async function getRedis(): Promise<import('ioredis').Redis | null> {
  if (redisClient) return redisClient
  try {
    const ioredis = await import('ioredis')
    const Redis = ioredis.default ?? (ioredis as unknown as { new(url: string, opts: object): import('ioredis').Redis })
    redisClient = new (Redis as unknown as new (url: string, opts: object) => import('ioredis').Redis)(
      process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 },
    )
    await (redisClient as import('ioredis').Redis & { connect(): Promise<void> }).connect()
    return redisClient!
  } catch {
    return null
  }
}

const SESSION_TTL = 3600

async function loadSession(conversationId: string): Promise<Session | null> {
  const r = await getRedis()
  if (!r) return null
  try {
    const raw = await r.get(`session:${conversationId}`)
    if (raw) return JSON.parse(raw) as Session
  } catch { /* redis unavailable */ }
  return null
}

async function saveSession(session: Session): Promise<void> {
  const r = await getRedis()
  if (!r) return
  try {
    await r.set(`session:${session.conversationId}`, JSON.stringify(session), 'EX', SESSION_TTL)
  } catch { /* redis unavailable */ }
}

function buildServices(): ExecutionServices {
  return { llm, db: prisma, httpFetch: fetch }
}

// ── Per-bot LLM config ────────────────────────────────────────────────────────
interface BotLlmConfig {
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
}

async function loadBotConfig(botId: string, botName: string): Promise<BotLlmConfig> {
  try {
    const cfg = await prisma.botConfig.findUnique({ where: { botId } })
    if (cfg) return { model: cfg.model, temperature: cfg.temperature, maxTokens: cfg.maxTokens, systemPrompt: cfg.systemPrompt }
  } catch { /* table may not exist yet before migration */ }
  return {
    model: 'claude-sonnet-4-5',
    temperature: 0.3,
    maxTokens: 2048,
    systemPrompt: `You are a helpful assistant for ${botName}. Answer using the provided knowledge base context. Be concise and professional. If the answer is not in the context, say so.`,
  }
}

// ── Conversation history (multi-turn memory) ──────────────────────────────────
async function loadHistory(conversationId: string, limit = 10): Promise<LlmMessage[]> {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit * 2, // over-fetch so we can pick full pairs
    })
    // Reverse to chronological order, map to LlmMessage roles
    return messages
      .reverse()
      .map((m: { direction: string; content: unknown }) => ({
        role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: (m.content as { text?: string })?.text ?? '',
      }))
      .filter((m: { content: string }) => m.content.trim().length > 0)
      .slice(-limit)
  } catch {
    return []
  }
}

// ── RAG search ────────────────────────────────────────────────────────────────
async function searchRag(query: string, tenantId: string, botId: string, topK = 5): Promise<string[]> {
  try {
    const embedResult = await embedAdapter.embed({ texts: [query] })
    const embedding = embedResult.embeddings[0]
    if (!embedding || embedding.length === 0) return []

    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...params: unknown[]) => Promise<Array<{ content: string }>>)(
      `SELECT dc.content
       FROM "document_chunks" dc
       JOIN "documents" d ON dc."documentId" = d.id
       JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
       WHERE dc."tenantId" = $2
         AND ks."botId" = $3
         AND dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> $1::vector
       LIMIT $4`,
      JSON.stringify(embedding),
      tenantId,
      botId,
      topK,
    )
    return rows.map((r) => r.content)
  } catch {
    return []
  }
}

// ── Direct LLM path (no flow) ─────────────────────────────────────────────────
async function handleDirectLlm(
  app: FastifyInstance,
  conversationId: string,
  tenantId: string,
  botId: string,
  botName: string,
  incomingText: string,
  named: NamePlan & { contact: VisitorName | null },
): Promise<void> {
  const [config, context, history] = await Promise.all([
    loadBotConfig(botId, botName),
    searchRag(incomingText, tenantId, botId),
    loadHistory(conversationId),
  ])

  // Build context block
  const contextBlock = context.length > 0
    ? `\n\n--- KNOWLEDGE BASE ---\n${context.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}\n--- END KNOWLEDGE BASE ---\n\nUse only the above context to answer. If the answer isn't there, say you don't know.`
    : ''

  // Compose messages: history (excluding the new message, which is already last) + current
  // loadHistory returns messages up to but not including the current one, since it was just saved
  const messages: LlmMessage[] = [
    ...history,
    { role: 'user', content: incomingText },
  ]

  let fullContent = ''
  const onChunk = (chunk: string) => {
    const clean = fillNameTokens(chunk, named.spoken)
    fullContent += clean
    app.broadcastToTenant(tenantId, { event: 'message.chunk', data: { conversationId, chunk: clean } })
  }

  await llm.stream({
    messages,
    systemPrompt: config.systemPrompt + contextBlock,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    onChunk,
  })

  if (!fullContent.trim()) {
    fullContent = "I'm sorry, I couldn't find a good answer for that right now."
  }
  const finished = finishBotLines([fullContent], named.contact, named.spoken, { conversationId })
  fullContent = finished.lines.join('\n\n')
  if (named.contact?.id && finished.metadata) {
    await saveContactName(named.contact.id, { metadata: finished.metadata }).catch(() => {})
  }

  const saved = await prisma.message.create({
    data: { tenantId, conversationId, direction: 'outbound', authorKind: 'bot', content: { text: fullContent } },
  })
  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
  app.broadcastToTenant(tenantId, { event: 'message.created', data: saved })
}

// ── Main entry point ──────────────────────────────────────────────────────────
export async function processInboundMessage(
  app: FastifyInstance,
  conversationId: string,
  tenantId: string,
  incomingText: string,
): Promise<void> {
  try {
    const convo = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        bot: {
          include: {
            flows: {
              include: { versions: { where: { status: 'published' }, orderBy: { version: 'desc' }, take: 1 } },
              take: 1,
            },
          },
        },
      },
    })
    if (!convo?.bot) return

    const named = await takeNameTurn(conversationId, incomingText)
    if (named.thanks) {
      const saved = await prisma.message.create({
        data: { tenantId, conversationId, direction: 'outbound', authorKind: 'bot', content: { text: named.thanks } },
      })
      app.broadcastToTenant(tenantId, { event: 'message.created', data: saved })
      return
    }

    const flow = convo.bot.flows?.[0]
    const version = flow?.versions?.[0]
    const botId = convo.botId ?? convo.bot.id

    // ── No published flow → direct RAG + LLM path ──────────────────────────
    if (!flow || !version?.graph) {
      await handleDirectLlm(app, conversationId, tenantId, botId, convo.bot.name, incomingText, named)
      return
    }

    // ── Published flow path ────────────────────────────────────────────────
    const graph = version.graph as unknown as import('@ybot/runtime').FlowGraph

    let session = await loadSession(conversationId)
    if (!session || session.status === 'completed' || session.status === 'handed_over') {
      const nodes = (graph.nodes ?? []) as Array<{ id: string; data: { kind: string } }>
      const startNode = nodes.find((n) => n.data.kind === 'trigger_start' || n.data.kind === 'start')
      if (!startNode) return
      session = {
        id: `s_${Date.now()}`,
        conversationId,
        botId,
        tenantId,
        flowId: flow.id,
        flowVersionId: version.id,
        currentNodeId: startNode.id,
        variables: { flow: { last_user_message: incomingText }, global: {}, contact: { name: named.spoken } },
        status: 'running',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    } else {
      session.variables.flow['last_user_message'] = incomingText
      session.variables.contact = { ...session.variables.contact, name: named.spoken }
    }

    const machine = new SessionMachine(buildServices())
    // Pass a streamChunk callback so llm_generate nodes emit real-time WS events
    const flowStreamChunk = (chunk: string) => {
      app.broadcastToTenant(tenantId, { event: 'message.chunk', data: { conversationId, chunk } })
    }
    await reopenForBot(conversationId)
    const result = await machine.run(session, graph, incomingText, flowStreamChunk)
    const keep = Boolean(result.handover) && !(await liveAgentsFor(botId))
    const spoken = result.newMessages.map((msg) => msg.content.text)

    const finished = finishBotLines(
      keep ? keepWithBot(spoken) : spoken,
      named.contact,
      named.spoken,
      { waiting: result.session.status === 'waiting_input', conversationId },
    )
    if (named.contact?.id && finished.metadata) {
      await saveContactName(named.contact.id, { metadata: finished.metadata }).catch(() => {})
    }
    for (const text of finished.lines) {
      if (!text.trim()) continue
      const saved = await prisma.message.create({
        data: { tenantId, conversationId, direction: 'outbound', authorKind: 'bot', content: { text } },
      })
      app.broadcastToTenant(tenantId, { event: 'message.created', data: saved })
    }

    if (result.handover && !keep) {
      await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'escalated', updatedAt: new Date() } })
    } else if (result.completed) {
      await resolveByBot(conversationId)
    }

    await saveSession(result.session)
  } catch (err) {
    app.log.error({ err, conversationId }, 'Runtime bridge error')
  }
}
