import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import { enqueueCampaignSend } from '../queues.js'

type JWT = { sub: string; tenantId: string; role: string }

export async function campaignsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('SUPERVISOR', 'ADMIN'))

  app.get('/:botId/campaigns', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    return { data: await prisma.campaign.findMany({ where: { botId, tenantId }, orderBy: { createdAt: 'desc' } }) }
  })

  app.post('/:botId/campaigns', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      name:        z.string().min(1),
      direction:   z.string().default('outbound'),
      channel:     z.string().optional(),
      status:      z.enum(['draft', 'scheduled', 'running']).default('draft'),
      scheduledAt: z.string().optional(),
      filters: z.object({
        hasEmail: z.boolean().optional(),
        hasPhone: z.boolean().optional(),
        channel: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const campaign = await prisma.campaign.create({
      data: {
        name:        body.data.name,
        direction:   body.data.direction,
        channel:     body.data.channel ?? 'email',
        status:      body.data.status,
        tenantId,
        botId,
        scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : undefined,
        filters:     (body.data.filters ?? {}) as never,
      },
    })
    if (body.data.status === 'running') {
      await enqueueCampaignSend({ tenantId, botId, campaignId: campaign.id }).catch(() => {})
    }
    return reply.status(201).send({ data: campaign })
  })

  app.patch('/:botId/campaigns/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({
      name: z.string().optional(),
      channel: z.string().optional(),
      status: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      scheduledAt: z.string().optional(),
      filters: z.object({
        hasEmail: z.boolean().optional(),
        hasPhone: z.boolean().optional(),
        channel: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION' } })
    const { filters, ...rest } = body.data
    const updated = await prisma.campaign.updateMany({
      where: { id, botId, tenantId },
      data: {
        ...rest,
        ...(rest.scheduledAt ? { scheduledAt: new Date(rest.scheduledAt) } : {}),
        ...(filters !== undefined ? { filters: filters as never } : {}),
      },
    })
    return { data: updated }
  })

  // GET /:botId/campaigns/audience-count — estimate audience size for given filters
  app.get('/:botId/campaigns/audience-count', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const q = request.query as { hasEmail?: string; hasPhone?: string; channel?: string; tags?: string }
    const where: Record<string, unknown> = { tenantId }
    if (q.hasEmail === 'true') where['email'] = { not: null }
    if (q.hasPhone === 'true') where['phone'] = { not: null }
    if (q.tags) {
      const tags = q.tags.split(',').map((t) => t.trim()).filter(Boolean)
      if (tags.length) where['tags'] = { hasEvery: tags }
    }
    if (q.channel) {
      where['conversations'] = { some: { channel: { kind: q.channel } } }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (prisma.contact.count as unknown as (args: { where: Record<string, unknown> }) => Promise<number>)({ where })
    return { data: { count } }
  })

  // POST /:botId/campaigns/:id/launch — transition to running/scheduled + enqueue
  app.post('/:botId/campaigns/:id/launch', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const campaign = await prisma.campaign.findFirst({ where: { id, botId, tenantId } })
    if (!campaign) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      return reply.status(400).send({ error: { code: 'INVALID_STATE', message: 'Only draft or paused campaigns can be launched' } })
    }
    const newStatus = campaign.scheduledAt && campaign.scheduledAt > new Date() ? 'scheduled' : 'running'
    await prisma.campaign.updateMany({ where: { id, botId, tenantId }, data: { status: newStatus, ...(newStatus === 'running' ? { sentAt: new Date() } : {}) } })
    await enqueueCampaignSend({ tenantId, botId, campaignId: id }).catch(() => {})
    return { data: { ok: true, status: newStatus } }
  })

  // POST /:botId/campaigns/:id/pause
  app.post('/:botId/campaigns/:id/pause', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const campaign = await prisma.campaign.findFirst({ where: { id, botId, tenantId } })
    if (!campaign) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    if (campaign.status !== 'running' && campaign.status !== 'scheduled') {
      return reply.status(400).send({ error: { code: 'INVALID_STATE', message: 'Only running or scheduled campaigns can be paused' } })
    }
    await prisma.campaign.updateMany({ where: { id, botId, tenantId }, data: { status: 'paused' } })
    return { data: { ok: true, status: 'paused' } }
  })

  app.delete('/:botId/campaigns/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    await prisma.campaign.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })

  // GET /:botId/campaigns/:id/deliveries
  app.get('/:botId/campaigns/:id/deliveries', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const campaign = await prisma.campaign.findFirst({ where: { id, botId, tenantId } })
    if (!campaign) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const deliveries = await prisma.campaignDelivery.findMany({
      where: { campaignId: id, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return { data: deliveries }
  })
}

export async function templatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/templates', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const q = request.query as Record<string, string>
    return { data: await prisma.template.findMany({
      where: { botId, tenantId, ...(q['channel'] ? { channel: q['channel'] } : {}), ...(q['status'] ? { approvalStatus: q['status'] } : {}) },
      orderBy: { createdAt: 'desc' },
    })}
  })

  app.post('/:botId/templates', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ name: z.string().min(1), channel: z.string(), content: z.record(z.any()), variables: z.array(z.string()).default([]), submitForReview: z.boolean().default(false) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const { submitForReview, ...data } = body.data
    return reply.status(201).send({ data: await prisma.template.create({ data: { ...data, tenantId, botId, approvalStatus: submitForReview ? 'pending' : 'draft' } }) })
  })

  app.patch('/:botId/templates/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({ name: z.string().optional(), content: z.record(z.any()).optional(), approvalStatus: z.string().optional() }).parse(request.body)
    return { data: await prisma.template.updateMany({ where: { id, botId, tenantId }, data: body }) }
  })

  app.delete('/:botId/templates/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    await prisma.template.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })
}
