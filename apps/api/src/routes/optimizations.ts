/**
 * Supervised optimisation routes — authenticated, tenant-scoped.
 *
 * GET  /:botId/optimizations                    list pending/applied/dismissed proposals
 * GET  /:botId/optimizations/:id               single proposal detail
 * POST /:botId/optimizations/:id/apply         apply to BotConfig.systemPrompt
 * POST /:botId/optimizations/:id/dismiss       mark dismissed
 * GET  /:botId/conversation-templates          list detected conversation patterns
 */

import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@botstudio/db'

type JWT = { sub: string; tenantId: string; role: string }

export async function optimizationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  // ── List optimizations ───────────────────────────────────────────────────
  app.get<{ Params: { botId: string } }>('/:botId/optimizations', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params
    const q = request.query as Record<string, string>

    const optimizations = await prisma.templateOptimization.findMany({
      where: {
        tenantId,
        botId,
        ...(q['status'] ? { status: q['status'] } : {}),
      },
      orderBy: [{ status: 'asc' }, { avgQualityScore: 'desc' }, { evidenceCount: 'desc' }],
    })
    return { data: optimizations }
  })

  // ── Single optimization ──────────────────────────────────────────────────
  app.get<{ Params: { botId: string; id: string } }>('/:botId/optimizations/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params
    const opt = await prisma.templateOptimization.findFirst({ where: { id, botId, tenantId } })
    if (!opt) return reply.status(404).send({ error: 'Not found' })
    return { data: opt }
  })

  // ── Apply optimization ───────────────────────────────────────────────────
  app.post<{ Params: { botId: string; id: string } }>('/:botId/optimizations/:id/apply', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params

    const opt = await prisma.templateOptimization.findFirst({ where: { id, botId, tenantId, status: 'pending' } })
    if (!opt) return reply.status(404).send({ error: 'Optimization not found or already actioned' })

    if (opt.kind === 'system_prompt') {
      // Upsert the BotConfig with the proposed value
      await prisma.botConfig.upsert({
        where: { botId },
        create: {
          tenantId, botId,
          model: 'claude-sonnet-4-5',
          temperature: 0.3,
          maxTokens: 2048,
          systemPrompt: opt.proposedValue,
        },
        update: { systemPrompt: opt.proposedValue },
      })
    }

    const updated = await prisma.templateOptimization.update({
      where: { id },
      data: { status: 'applied', appliedAt: new Date() },
    })

    // Log the activity
    const jwt = request.user as JWT
    await prisma.activity.create({
      data: {
        tenantId, userId: jwt.sub,
        action: 'optimization.applied',
        resource: 'TemplateOptimization',
        resourceId: id,
        metadata: { title: opt.title, botId },
      },
    }).catch(() => {})

    return { data: updated }
  })

  // ── Dismiss optimization ─────────────────────────────────────────────────
  app.post<{ Params: { botId: string; id: string } }>('/:botId/optimizations/:id/dismiss', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params
    const opt = await prisma.templateOptimization.findFirst({ where: { id, botId, tenantId } })
    if (!opt) return reply.status(404).send({ error: 'Not found' })
    const updated = await prisma.templateOptimization.update({ where: { id }, data: { status: 'dismissed' } })
    return { data: updated }
  })

  // ── List conversation templates ──────────────────────────────────────────
  app.get<{ Params: { botId: string } }>('/:botId/conversation-templates', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params
    const templates = await prisma.conversationTemplate.findMany({
      where: { tenantId, botId },
      orderBy: { avgQualityScore: 'desc' },
    })
    return { data: templates }
  })
}
