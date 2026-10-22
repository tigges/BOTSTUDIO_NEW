/**
 * Analytics dashboard routes — authenticated, tenant-scoped.
 *
 * GET    /:botId/dashboards          list dashboards
 * POST   /:botId/dashboards          create dashboard
 * PATCH  /:botId/dashboards/:id      update (name, pinned, layout)
 * DELETE /:botId/dashboards/:id      delete dashboard
 */

import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import { ANALYTICS_METRICS } from '@botstudio/shared'

type JWT = { sub: string; tenantId: string; role: string }

export async function dashboardsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/dashboards', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    return {
      data: await prisma.dashboard.findMany({
        where: { botId, tenantId },
        include: { widgets: true },
        orderBy: { createdAt: 'asc' },
      }),
    }
  })

  app.post('/:botId/dashboards', async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      name:    z.string().min(1),
      layout:  z.array(z.any()).default([]),
      pinned:  z.boolean().default(false),
      tags:    z.array(z.string()).default([]),
      author:  z.string().optional(),
      widgets: z.array(z.object({ title: z.string().min(1), metric: z.enum(ANALYTICS_METRICS) })).max(12).default([]),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const dashboard = await prisma.dashboard.create({
      data: {
        name: body.data.name,
        layout: body.data.layout as never,
        tenantId,
        botId,
        widgets: { create: body.data.widgets.map((w) => ({ tenantId, kind: 'metric', title: w.title, config: { metric: w.metric } })) },
      },
      include: { widgets: true },
    })
    return reply.status(201).send({ data: dashboard })
  })

  app.patch('/:botId/dashboards/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({
      name:   z.string().optional(),
      layout: z.array(z.any()).optional(),
    }).parse(request.body)
    const result = await prisma.dashboard.updateMany({
      where: { id, botId, tenantId },
      data: body as never,
    })
    if (result.count === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    return { data: { ok: true } }
  })

  app.delete('/:botId/dashboards/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    await prisma.dashboard.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })
}
