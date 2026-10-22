/**
 * GET /bots/:botId/settings  the three execution settings, and which model providers are connected
 * PUT /bots/:botId/settings  save them; the audit row keeps before and after
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '@botstudio/db'
import { DEFAULT_MODELS, currentModelId, resolveLlmEnv } from '@botstudio/llm'
import { MODEL_GROUPS, MODEL_IDS, readBotSettings, responseLength, type BotSettings } from '@botstudio/shared'
import { requireRole } from '../middleware/auth.js'

type JWT = { sub: string; tenantId: string; role: string }

function settingsOf(cfg: { model: string; responseLength: string; toolWaitEscalateSeconds: number | null } | null): BotSettings {
  return {
    model: currentModelId(cfg?.model ?? DEFAULT_MODELS.anthropic),
    responseLength: responseLength(cfg?.responseLength),
    toolWaitEscalateSeconds: cfg?.toolWaitEscalateSeconds ?? null,
  }
}

function connectedProviders(): Record<string, boolean> {
  const env = resolveLlmEnv(process.env as Record<string, string | undefined>)
  return Object.fromEntries(MODEL_GROUPS.map((group) => [group.envVar, Boolean(env[group.envVar])]))
}

export async function botSettingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/:botId/settings', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const cfg = await prisma.botConfig.findUnique({ where: { botId }, select: { model: true, responseLength: true, toolWaitEscalateSeconds: true } })
    return { data: { settings: settingsOf(cfg), connected: connectedProviders() } }
  })

  app.put('/:botId/settings', { preHandler: requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN') }, async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const parsed = readBotSettings(request.body, MODEL_IDS)
    if (!parsed.ok) return reply.status(400).send({ error: { code: 'VALIDATION', field: parsed.field, message: parsed.message } })
    const before = await prisma.botConfig.findUnique({ where: { botId }, select: { model: true, responseLength: true, toolWaitEscalateSeconds: true } })
    const next = parsed.settings
    const saved = await prisma.botConfig.upsert({
      where: { botId },
      create: { tenantId, botId, ...next },
      update: next,
      select: { model: true, responseLength: true, toolWaitEscalateSeconds: true },
    })
    const was = settingsOf(before)
    const now = settingsOf(saved)
    const changes = (Object.keys(now) as Array<keyof BotSettings>).filter((key) => was[key] !== now[key])
    await prisma.activity.create({
      data: {
        tenantId,
        userId: sub,
        action: 'bot.settings_changed',
        resource: 'bot',
        resourceId: botId,
        metadata: { before: was as object, after: now as object, changes },
      },
    })
    return { data: { settings: settingsOf(saved), connected: connectedProviders() } }
  })
}
