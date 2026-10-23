/**
 * Test routes for the flow builder. Both run the live turn pipeline over the
 * working copy (lib/test-chat.ts) and write nothing to the chat list.
 *
 * POST /api/v1/bots/:botId/preview/chat     Test Bot on the canvas (Server-Sent Events)
 *   Body: { message, opening?, graph?, flowName?, state? }
 *     - event: chunk   data: {"text": "..."}
 *     - event: done    data: {"fullText": "...", "state": {...}, "path": "...", "chapter": "..."}
 *     - event: error   data: {"message": "..."}
 *
 * POST /api/v1/bots/:botId/preview/journey  Journey Test (JSON)
 * POST /api/v1/preview/journey               Journey Test while a new bot is still a draft
 *   Body: { chapters, startChapter, message, environmentLabel, state?, catalog? }
 *
 * A handover the team can take turns the test chat into a Sandbox chat in the Inbox
 * (state.inboxChatId). The panel polls the person's replies:
 * GET  /api/v1/bots/:botId/preview/inbox-chat/:conversationId?after=ISO
 *
 * GET  /api/v1/bots/:botId/preview/knowledge-stats
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@botstudio/db'
import { type FlowGraph } from '@botstudio/runtime'
import { z } from 'zod'
import type { StudioCatalog } from '@botstudio/shared'
import { savedJourney } from '../lib/flow-runner.js'
import { openEventStream } from '../lib/event-stream.js'
import { runTestTurn, withWorkingCopy, type TestChatDeps, type TestChatState } from '../lib/test-chat.js'
import { testInboxReplies } from '../lib/test-chat-inbox.js'

type JWT = { sub: string; tenantId: string; role: string }

const graphSchema = z.object({
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
})

const lineSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })

/** The state a test chat handed out on its last turn. */
const stateSchema = z.object({
  session: z.object({
    id: z.string(),
    botId: z.string(),
    tenantId: z.string(),
    flowId: z.string(),
    flowVersionId: z.string(),
    currentNodeId: z.string(),
    variables: z.unknown(),
    status: z.string(),
    waitingFor: z.unknown(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).nullable(),
  contactMeta: z.record(z.unknown()),
  transcript: z.array(lineSchema).max(80),
  status: z.enum(['active', 'resolved', 'escalated']),
  outcome: z.enum(['contained_resolved', 'contained_partial', 'contained_unresolved', 'escalated', 'abandoned']).nullable(),
  subject: z.string().nullable(),
  handover: z.record(z.unknown()).nullable(),
  ticket: z.object({ subject: z.string(), description: z.string() }).nullable(),
  inboxChatId: z.string().max(64).nullable().optional(),
})

/** The Inbox chat a test state points at must be this bot's, or the state forgets it. */
async function ownInboxChat(tenantId: string, botId: string | undefined, state: TestChatState | undefined): Promise<TestChatState | undefined> {
  if (!state?.inboxChatId) return state
  const chat = botId
    ? await prisma.conversation.findFirst({ where: { id: state.inboxChatId, tenantId, botId }, select: { id: true } })
    : null
  return chat ? state : { ...state, inboxChatId: null }
}

const catalogSchema = z.object({
  facts: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    phrases: z.array(z.string()),
    fact: z.string(),
    source: z.string().optional(),
  })),
})

const TEST_CHAT_FAILED = 'This test chat could not answer just now. Reset the chat to try again.'

const journeyBody = z.object({
  chapters: z.array(z.object({
    name: z.string().min(1).max(120),
    graph: graphSchema,
  })).min(1).max(40),
  startChapter: z.string().min(1).max(120),
  message: z.string().max(4000).default(''),
  environmentLabel: z.string().min(1).max(40).default('Sandbox'),
  state: stateSchema.optional(),
  catalog: catalogSchema.optional(),
})

/** A bot that is not created yet has a new bot's defaults: nobody on chat, no always-human words, no knowledge. */
const DRAFT_DEPS: Partial<TestChatDeps> = {
  handoverRules: async () => ({ liveAgents: false, alwaysHuman: [] }),
  catalog: async () => undefined,
}

async function journeyTurn(request: FastifyRequest, reply: FastifyReply, botId: string | undefined) {
  const { tenantId } = request.user as JWT
  const body = journeyBody.safeParse(request.body)
  if (!body.success) {
    return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
  }
  try {
    const turn = await runTestTurn({
      tenantId,
      botId: botId ?? '',
      chapters: body.data.chapters.map((chapter) => ({ name: chapter.name, graph: chapter.graph as FlowGraph })),
      startChapter: body.data.startChapter,
      environmentLabel: body.data.environmentLabel,
      message: body.data.message,
      catalog: body.data.catalog as StudioCatalog | undefined,
      state: await ownInboxChat(tenantId, botId, body.data.state as TestChatState | undefined),
      inbox: Boolean(botId),
    }, botId ? {} : DRAFT_DEPS)
    return { data: turn }
  } catch (err) {
    request.log.warn({ err }, 'journey test failed')
    return reply.status(500).send({ error: { code: 'JOURNEY', message: TEST_CHAT_FAILED } })
  }
}

export async function previewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.post<{ Params: { botId: string } }>('/:botId/preview/chat', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params
    const body = z.object({
      message: z.string().max(4000).default(''),
      opening: z.boolean().optional(),
      graph: graphSchema.optional(),
      flowName: z.string().min(1).max(120).optional(),
      state: stateSchema.optional(),
    }).safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    }
    const { message, opening, graph, flowName, state } = body.data
    if (!message.trim() && !opening) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Type a message, or open the chat.' } })
    }

    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })

    const saved = await savedJourney(botId)
    const startChapter = graph ? (flowName ?? 'This chart') : saved.entry
    const chapters = graph ? withWorkingCopy(saved.chapters, startChapter!, graph as FlowGraph) : saved.chapters

    const stream = openEventStream(reply)
    const send = (event: string, data: object) => stream.send(data, event)
    try {
      const turn = await runTestTurn({
        tenantId,
        botId,
        chapters,
        startChapter: startChapter ?? '',
        environmentLabel: 'Sandbox',
        message,
        opening,
        state: await ownInboxChat(tenantId, botId, state as TestChatState | undefined),
        inbox: true,
        onChunk: (text) => send('chunk', { text }),
      })
      send('done', { fullText: turn.text, state: turn.state, path: turn.path, ended: turn.ended, chapter: turn.chapter, tools: turn.tools })
    } catch (err) {
      request.log.warn({ err }, 'test chat failed')
      send('error', { message: TEST_CHAT_FAILED })
    } finally {
      stream.end()
    }
  })

  app.post<{ Params: { botId: string } }>('/:botId/preview/journey', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const bot = await prisma.bot.findFirst({ where: { id: request.params.botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    return journeyTurn(request, reply, bot.id)
  })

  app.get<{ Params: { botId: string; conversationId: string }; Querystring: { after?: string } }>('/:botId/preview/inbox-chat/:conversationId', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const after = request.query.after ? new Date(request.query.after) : null
    const result = await testInboxReplies(tenantId, request.params.botId, request.params.conversationId, after && !Number.isNaN(after.getTime()) ? after : null)
    if (!result) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This test chat is no longer in the Inbox.' } })
    return { data: result }
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

export async function draftPreviewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))
  app.post('/preview/journey', (request, reply) => journeyTurn(request, reply, undefined))
}
