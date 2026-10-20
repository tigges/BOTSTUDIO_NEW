/**
 * Contact memory.
 *
 * GET    /bots/:botId/memory                 settings, the journey's variables, how many facts are kept
 * PUT    /bots/:botId/memory                 which answers to remember and for how long
 * GET    /contacts/:id/memory                what bots remember about one contact
 * DELETE /contacts/:id/memory/:key           forget one fact
 * DELETE /contacts/:id/memory                forget everything about the contact
 * GET    /conversations/:id/memory           the facts for the chat's contact (Inbox side panel)
 *
 * Values reach people through the bot's Human agent render mode.
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@ybot/db'
import { z } from 'zod'
import { MEMORY_MAX_DAYS, MEMORY_MAX_KEYS, journeyVariables, memoryIssues, parseMemorySettings } from '@ybot/shared'
import { requireRole } from '../middleware/auth.js'
import { agentViewsFor } from '../lib/present-chat.js'
import { savedJourney } from '../lib/flow-runner.js'

type JWT = { sub: string; tenantId: string; role: string }

const memoryBody = z.object({
  enabled: z.boolean(),
  keys: z.array(z.string().trim().max(64)).max(MEMORY_MAX_KEYS * 2),
  days: z.number().int().min(1).max(MEMORY_MAX_DAYS),
})

async function presentFacts(tenantId: string, contactId: string, now = new Date()) {
  const rows = await prisma.contactMemory.findMany({
    where: { tenantId, contactId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { key: 'asc' },
  })
  const botIds = [...new Set(rows.map((row) => row.botId).filter((id): id is string => Boolean(id)))]
  const [viewOf, bots] = await Promise.all([
    agentViewsFor(botIds, tenantId),
    prisma.bot.findMany({ where: { id: { in: botIds }, tenantId }, select: { id: true, name: true } }),
  ])
  const botName = new Map(bots.map((bot) => [bot.id, bot.name]))
  return rows.map((row) => ({
    key: row.key,
    value: viewOf(row.botId)(row.value),
    botId: row.botId,
    botName: row.botId ? botName.get(row.botId) ?? null : null,
    conversationId: row.conversationId,
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  }))
}

export async function botMemoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/memory', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true, config: { select: { memory: true } } } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    const settings = parseMemorySettings(bot.config?.memory)
    const [journey, kept] = await Promise.all([
      savedJourney(botId).catch(() => ({ chapters: [] })),
      prisma.contactMemory.groupBy({ by: ['key'], where: { tenantId, botId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, _count: { _all: true } }),
    ])
    return {
      data: {
        settings,
        variables: journeyVariables(journey.chapters.map((chapter) => chapter.graph as never)),
        kept: Object.fromEntries(kept.map((row) => [row.key, row._count._all])),
      },
    }
  })

  app.put('/:botId/memory', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    const body = memoryBody.safeParse(request.body)
    if (!body.success) {
      const first = body.error.issues[0]
      const field = first?.path.join('.') ?? ''
      const message = field === 'days' ? `Forget after: enter a number of days between 1 and ${MEMORY_MAX_DAYS}.` : `Answers to remember: ${first?.message ?? 'check the list.'}`
      return reply.status(422).send({ error: { code: 'MEMORY_INVALID', message, issues: [{ field, message }] } })
    }
    const keys = [...new Set(body.data.keys.filter(Boolean))]
    const issues = memoryIssues({ ...body.data, keys })
    if (issues.length) return reply.status(422).send({ error: { code: 'MEMORY_INVALID', message: issues[0]!.message, issues } })
    const settings = parseMemorySettings({ ...body.data, keys })
    await prisma.botConfig.upsert({
      where: { botId },
      create: { tenantId, botId, memory: settings as object },
      update: { memory: settings as object },
    })
    return { data: settings }
  })
}

export async function contactMemoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/contacts/:id/memory', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const contact = await prisma.contact.findFirst({ where: { id, tenantId }, select: { id: true } })
    if (!contact) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This contact no longer exists.' } })
    return { data: await presentFacts(tenantId, id) }
  })

  app.delete('/contacts/:id/memory/:key', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id, key } = request.params as { id: string; key: string }
    const row = await prisma.contactMemory.findFirst({ where: { tenantId, contactId: id, key }, select: { id: true } })
    if (row) await prisma.contactMemory.delete({ where: { id: row.id } })
    return reply.status(204).send()
  })

  app.delete('/contacts/:id/memory', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const contact = await prisma.contact.findFirst({ where: { id, tenantId }, select: { id: true } })
    if (!contact) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This contact no longer exists.' } })
    const result = await prisma.contactMemory.deleteMany({ where: { tenantId, contactId: id } })
    return { data: { forgotten: result.count } }
  })

  app.get('/conversations/:id/memory', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const convo = await prisma.conversation.findFirst({ where: { id, tenantId }, select: { contactId: true } })
    if (!convo) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This chat no longer exists.' } })
    if (!convo.contactId) return { data: { contactId: null, facts: [] } }
    return { data: { contactId: convo.contactId, facts: await presentFacts(tenantId, convo.contactId) } }
  })
}
