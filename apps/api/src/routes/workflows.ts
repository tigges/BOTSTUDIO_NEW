/**
 * Automation workflow routes — authenticated, tenant-scoped.
 *
 * GET    /:botId/workflows         list all automation rules
 * POST   /:botId/workflows         create a new rule
 * PATCH  /:botId/workflows/:id     update a rule
 * DELETE /:botId/workflows/:id     delete a rule
 * POST   /:botId/workflows/:id/toggle  toggle active/paused
 */

import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@botstudio/db'
import { z } from 'zod'

type JWT = { sub: string; tenantId: string; role: string }

const VALID_TRIGGERS = [
  'conversation.resolved',
  'conversation.escalated',
  'message.received',
  'contact.created',
  'csat.submitted',
  'sla.breached',
  'ticket.created',
  'schedule',
  'intent_matched',
] as const

const VALID_STATUSES = ['active', 'paused', 'draft'] as const

export async function workflowsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/workflows', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const q = request.query as { status?: string }
    return {
      data: await prisma.automationRule.findMany({
        where: { botId, tenantId, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
    }
  })

  app.post('/:botId/workflows', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      name:        z.string().min(1),
      description: z.string().optional(),
      trigger:     z.enum(VALID_TRIGGERS),
      conditions:  z.string().default(''),
      actions:     z.array(z.string()).default([]),
      status:      z.enum(VALID_STATUSES).default('draft'),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const rule = await prisma.automationRule.create({
      data: { ...body.data, tenantId, botId },
    })
    return reply.status(201).send({ data: rule })
  })

  app.patch('/:botId/workflows/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({
      name:        z.string().min(1).optional(),
      description: z.string().optional(),
      trigger:     z.enum(VALID_TRIGGERS).optional(),
      conditions:  z.string().optional(),
      actions:     z.array(z.string()).optional(),
      status:      z.enum(VALID_STATUSES).optional(),
    }).parse(request.body)
    const rule = await prisma.automationRule.updateMany({
      where: { id, botId, tenantId },
      data: body,
    })
    if (rule.count === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    return { data: { ok: true } }
  })

  app.post('/:botId/workflows/:id/toggle', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const rule = await prisma.automationRule.findFirst({ where: { id, botId, tenantId } })
    if (!rule) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const newStatus = rule.status === 'active' ? 'paused' : 'active'
    await prisma.automationRule.updateMany({ where: { id, botId, tenantId }, data: { status: newStatus } })
    return { data: { status: newStatus } }
  })

  app.delete('/:botId/workflows/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    await prisma.automationRule.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })
}
