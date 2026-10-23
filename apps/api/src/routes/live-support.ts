/**
 * Live support: the one switch that decides whether handed-over chats reach a person.
 *
 * GET   /bots/:botId/live-support   the switch, the schedule and whether the team is on chat now
 * PATCH /bots/:botId/live-support   turn it on or off, or change the opening hours
 *
 * Everyone in the Inbox can see it. Supervisors and admins change it.
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import { DEFAULT_MODELS } from '@botstudio/llm'
import { requireRole } from '../middleware/auth.js'
import { liveSupportView, withLiveSupport } from '../lib/live-support.js'

type JWT = { sub: string; tenantId: string; role: string }

const clock = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

const changeBody = z.object({
  enabled: z.boolean().optional(),
  followHours: z.boolean().optional(),
  start: clock.optional(),
  end: clock.optional(),
  timezone: z.string().min(1).max(64).refine(validZone, 'Unknown time zone').optional(),
  days: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day').max(7).optional(),
}).strict()

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export async function liveSupportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  const ownBot = (tenantId: string, botId: string) =>
    prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })

  app.get('/:botId/live-support', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const cfg = await prisma.botConfig.findUnique({ where: { botId }, select: { inboxConfig: true } })
    return { data: liveSupportView(cfg?.inboxConfig) }
  })

  app.patch('/:botId/live-support', { preHandler: requireRole('SUPERVISOR', 'ADMIN') }, async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = changeBody.safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })

    const before = await prisma.botConfig.findUnique({ where: { botId }, select: { inboxConfig: true } })
    const was = liveSupportView(before?.inboxConfig)
    const inboxConfig = withLiveSupport(before?.inboxConfig, body.data) as object
    await prisma.botConfig.upsert({
      where: { botId },
      create: { tenantId, botId, model: DEFAULT_MODELS.anthropic, temperature: 0.3, maxTokens: 2048, systemPrompt: 'You are a helpful assistant.', inboxConfig },
      update: { inboxConfig },
    })
    const view = liveSupportView(inboxConfig)
    const action = was.enabled !== view.enabled
      ? (view.enabled ? 'live_support.turned_on' : 'live_support.turned_off')
      : 'live_support.updated'
    await prisma.activity.create({
      data: {
        tenantId,
        userId: sub,
        action,
        resource: 'bot',
        resourceId: botId,
        metadata: { enabled: view.enabled, followHours: view.followHours, schedule: view.schedule },
      },
    }).catch(() => {})
    return { data: view }
  })
}
