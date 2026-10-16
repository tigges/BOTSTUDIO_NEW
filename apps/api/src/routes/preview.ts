/**
 * Bot preview / test-run routes.
 *
 * POST /api/v1/bots/:botId/preview/chat
 *   Body: { message: string; sessionId?: string; systemPrompt?: string }
 *   Response: Server-Sent Events (text/event-stream)
 *     - event: chunk   data: {"text": "..."}
 *     - event: done    data: {"sessionId": "...", "fullText": "..."}
 *     - event: error   data: {"message": "..."}
 *
 * This endpoint is used by the chatbot widget preview panel in the flow builder.
 * It does not create persistent DB records — purely ephemeral for testing.
 */

import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@ybot/db'
import { createLlmAdapter, createLlmAdapterForModel, createEmbeddingAdapter } from '@ybot/llm'
import type { FlowGraph } from '@ybot/runtime'
import { z } from 'zod'
import { CATALOG_ENTITY, catalogFromValues } from '@ybot/shared'
import { keepFirstQuestion, runCanvasPreview, type PreviewSnapshot } from '../lib/preview-flow.js'


// Shared adapters (module-level singletons)
const llm = createLlmAdapter()
const embedAdapter = createEmbeddingAdapter()

type JWT = { sub: string; tenantId: string; role: string }

async function searchKnowledge(query: string, tenantId: string, botId: string, topK = 5): Promise<string[]> {
  try {
    const embedResult = await embedAdapter.embed({ texts: [query] })
    const embedding = embedResult.embeddings[0]
    if (!embedding || embedding.length === 0) return []

    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...params: unknown[]) => Promise<Array<{ content: string }>>)(
      `SELECT dc.content
       FROM "document_chunks" dc
       JOIN "documents" d ON dc."documentId" = d.id
       JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
       WHERE dc."tenantId" = $1
         AND ks."botId" = $2
         AND dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> $3::vector
       LIMIT $4`,
      tenantId,
      botId,
      JSON.stringify(embedding),
      topK,
    )
    return rows.map((r) => r.content)
  } catch {
    return []
  }
}

export async function previewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  /**
   * POST /api/v1/bots/:botId/preview/chat
   * Streams an SSE response: chunks from Claude with RAG context from the bot's knowledge base.
   */
  app.post<{ Params: { botId: string } }>('/:botId/preview/chat', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params
    const body = z.object({
      message: z.string().min(1).max(4000),
      systemPrompt: z.string().optional(),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).default([]),
      graph: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          data: z.object({
            kind: z.string(),
            label: z.string().optional(),
            config: z.record(z.unknown()).optional(),
          }).passthrough(),
        }).passthrough()),
        edges: z.array(z.object({
          id: z.string(),
          source: z.string(),
          target: z.string(),
          sourceHandle: z.string().optional(),
        }).passthrough()),
      }).optional(),
      session: z.object({
        currentNodeId: z.string(),
        status: z.enum(['running', 'waiting_input', 'completed', 'failed', 'handed_over']),
        waitingFor: z.object({
          nodeId: z.string(),
          variable: z.string(),
          type: z.string(),
          choices: z.array(z.string()).optional(),
        }).optional(),
        variables: z.object({
          flow: z.record(z.unknown()),
          global: z.record(z.unknown()),
          contact: z.record(z.unknown()),
        }),
      }).optional(),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    }

    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })

    const { message, systemPrompt, history, graph, session } = body.data

    if (graph) {
      try {
        const catalogRow = await prisma.entity.findFirst({ where: { botId, tenantId, name: CATALOG_ENTITY } }).catch(() => null)
        const turn = await runCanvasPreview({
          graph: graph as FlowGraph,
          message,
          session: session as PreviewSnapshot | undefined,
          catalog: catalogFromValues(catalogRow?.values),
        })
        if (turn.handled) {
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          const sendFlow = (event: string, data: object) => {
            reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          }
          sendFlow('chunk', { text: turn.text })
          sendFlow('done', { fullText: turn.text, ragChunks: 0, session: turn.session })
          reply.raw.end()
          return
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`)
        reply.raw.end()
        return
      }
    }

    // Load per-bot model config
    const cfg = await prisma.botConfig.findUnique({ where: { botId } }).catch(() => null)
    const botModel = cfg?.model ?? undefined

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    function sendEvent(event: string, data: object) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const context = await searchKnowledge(message, tenantId, botId)

      const defaultSystem = `You are a helpful assistant for "${bot.name}". Be concise and friendly. Ask at most one question. Do not list several questions. If you don't know something, say so.`
      const activeSystemPrompt = systemPrompt ?? defaultSystem

      const contextBlock = context.length > 0
        ? `\n\n--- KNOWLEDGE BASE CONTEXT ---\n${context.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}\n--- END CONTEXT ---\n\nUse only the above context to answer. If the answer isn't there, say you don't know.`
        : ''

      let fullText = ''

      const messages = [
        ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        { role: 'user' as const, content: message },
      ]

      await (botModel ? createLlmAdapterForModel(botModel) : llm).stream({
        messages,
        systemPrompt: activeSystemPrompt + contextBlock,
        temperature: cfg?.temperature ?? 0.3,
        maxTokens: cfg?.maxTokens ?? 1024,
        onChunk: (chunk) => {
          fullText += chunk
        },
      })

      const spoken = keepFirstQuestion(fullText)
      sendEvent('chunk', { text: spoken })
      sendEvent('done', { fullText: spoken, ragChunks: context.length })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendEvent('error', { message: msg })
    } finally {
      reply.raw.end()
    }
  })

  /**
   * GET /api/v1/bots/:botId/preview/knowledge-stats
   * Returns count of indexed chunks for this bot (helps the widget show RAG status).
   */
  app.get<{ Params: { botId: string } }>('/:botId/preview/knowledge-stats', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params

    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })

    const result = await (prisma.$queryRawUnsafe as (sql: string, ...params: unknown[]) => Promise<Array<{ chunk_count: string; source_count: string }>>)(
      `SELECT
         COUNT(dc.id)::text AS chunk_count,
         COUNT(DISTINCT ks.id)::text AS source_count
       FROM "document_chunks" dc
       JOIN "documents" d ON dc."documentId" = d.id
       JOIN "knowledge_sources" ks ON d."knowledgeSourceId" = ks.id
       WHERE dc."tenantId" = $1 AND ks."botId" = $2 AND dc.embedding IS NOT NULL`,
      tenantId,
      botId,
    ).catch(() => [{ chunk_count: '0', source_count: '0' }])

    const row = result[0] ?? { chunk_count: '0', source_count: '0' }
    return { data: { chunkCount: parseInt(row.chunk_count, 10), sourceCount: parseInt(row.source_count, 10) } }
  })
}
