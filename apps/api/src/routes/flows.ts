import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@ybot/db'
import { z } from 'zod'
import { attachDestination } from '../lib/welcome-routes.js'
import { journeyTraffic } from '../lib/journey-traffic.js'
import { inspectFlowGraph, versionsForEnvironmentList } from '@ybot/shared'
import { publishToProduction } from '../lib/publish.js'
import { sendPublishError } from './releases.js'
import { LearnError, dismissLearningDraft, learnFromRated, learnFromSamples, learnSnapshot, publishLearningDraft } from '../lib/learn-store.js'

type JWT = { sub: string; tenantId: string; role: string }

export async function flowsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  // GET /bots/:botId/flows
  app.get('/:botId/flows', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const flows = await prisma.flow.findMany({
      where: { botId, tenantId },
      include: { versions: { orderBy: { version: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    })
    return {
      data: flows.map((flow) => ({
        ...flow,
        versions: versionsForEnvironmentList(flow.versions),
      })),
    }
  })

  // GET /bots/:botId/journey-traffic
  app.get('/:botId/journey-traffic', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const { environmentId } = request.query as { environmentId?: string }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const traffic = await journeyTraffic(prisma, tenantId, botId, since, environmentId || undefined)
    return { data: { days: 30, ...traffic } }
  })

  // POST /bots/:botId/flows
  app.post('/:botId/flows', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      kind: z.string().default('flow'),
      tags: z.array(z.string()).default([]),
      graph: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    const { graph, ...flowData } = body.data
    const flow = await prisma.flow.create({
      data: { ...flowData, tenantId, botId },
    })
    const version = await prisma.flowVersion.create({
      data: { tenantId, flowId: flow.id, version: 1, status: 'draft', graph: graph ?? { nodes: [], edges: [] }, variables: [] },
    })
    return reply.status(201).send({ data: { ...flow, versions: [version] } })
  })

  // GET /bots/:botId/flows/:flowId
  app.get('/:botId/flows/:flowId', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, flowId } = request.params as { botId: string; flowId: string }
    const flow = await prisma.flow.findFirst({
      where: { id: flowId, botId, tenantId },
      include: { versions: { orderBy: { version: 'desc' } } },
    })
    if (!flow) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    return { data: flow }
  })

  // PATCH /bots/:botId/flows/:flowId
  app.patch('/:botId/flows/:flowId', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, flowId } = request.params as { botId: string; flowId: string }
    const body = z.object({ name: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    const flow = await prisma.flow.updateMany({
      where: { id: flowId, botId, tenantId },
      data: body.data,
    })
    return { data: flow }
  })

  // DELETE /bots/:botId/flows/:flowId
  app.delete('/:botId/flows/:flowId', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, flowId } = request.params as { botId: string; flowId: string }
    await prisma.flow.deleteMany({ where: { id: flowId, botId, tenantId } })
    return reply.status(204).send()
  })

  // GET /bots/:botId/flows/:flowId/versions/:version/canvas
  app.get('/:botId/flows/:flowId/versions/:version/canvas', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, flowId, version } = request.params as { botId: string; flowId: string; version: string }
    const ver = await prisma.flowVersion.findFirst({
      where: { flowId, version: parseInt(version), flow: { botId, tenantId } },
    })
    if (!ver) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    return { data: ver }
  })

  // PUT /bots/:botId/flows/:flowId/versions/:version/canvas  (save graph)
  app.put('/:botId/flows/:flowId/versions/:version/canvas', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, flowId, version } = request.params as { botId: string; flowId: string; version: string }
    const body = z.object({ graph: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }), variables: z.array(z.any()).optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    const target = await prisma.flowVersion.findFirst({
      where: { flowId, version: parseInt(version), flow: { botId, tenantId } },
    })
    if (!target) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This flow version no longer exists. Reload the page.' } })
    const data = { graph: body.data.graph, variables: body.data.variables ?? [] }
    if (target.status !== 'published') {
      const saved = await prisma.flowVersion.update({ where: { id: target.id }, data })
      return { data: { ...saved, forked: false } }
    }
    // Published versions never change: the edit lands in the draft above it, made on first save.
    const newest = await prisma.flowVersion.findFirst({ where: { flowId }, orderBy: { version: 'desc' } })
    const saved = newest && newest.status !== 'published' && newest.version > target.version
      ? await prisma.flowVersion.update({ where: { id: newest.id }, data })
      : await prisma.flowVersion.create({
        data: { tenantId, flowId, version: (newest?.version ?? target.version) + 1, status: 'draft', ...data },
      })
    return { data: { ...saved, forked: true } }
  })

  // POST /bots/:botId/flows/:flowId/publish  (publish draft to environment)
  app.post('/:botId/flows/:flowId/publish', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, flowId } = request.params as { botId: string; flowId: string }
    const body = z.object({
      environmentId: z.string().min(1),
      version: z.number().int().positive().optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'environmentId is required' } })
    const { environmentId, version } = body.data
    const latest = await prisma.flowVersion.findFirst({
      where: { flowId, flow: { botId, tenantId }, ...(version ? { version } : {}) },
      orderBy: { version: 'desc' },
    })
    if (!latest) return reply.status(404).send({ error: { code: 'NO_VERSION', message: 'No flow version found' } })

    const names = await prisma.flow.findMany({ where: { botId, tenantId }, select: { name: true } })
    const tools = await prisma.tool.findMany({ where: { botId, tenantId }, select: { id: true } })
    const blocking = inspectFlowGraph(latest.graph as { nodes: []; edges: [] } | null, { flowNames: names.map((item) => item.name), toolIds: tools.map((tool) => tool.id) })
      .filter((issue) => issue.level === 'repair' || issue.level === 'block')
    if (blocking.length > 0) {
      return reply.status(422).send({
        error: { code: 'FLOW_CHECK', message: blocking[0]?.message ?? 'This flow still has connection gaps.', issues: blocking },
      })
    }

    const environment = await prisma.environment.findFirst({ where: { id: environmentId, botId, tenantId }, select: { kind: true } })
    if (!environment) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'That environment does not belong to this bot.' } })
    if (environment.kind === 'production') {
      try {
        const result = await publishToProduction({ tenantId, botId, environmentId, chapterVersionId: latest.id, userId: (request.user as JWT).sub })
        await prisma.activity.create({ data: { tenantId, userId: (request.user as JWT).sub, action: 'flow.published', resource: 'flow', resourceId: flowId, metadata: { version: latest.version, environmentId, release: result.release.number } } })
        const published = await prisma.flowVersion.findUnique({ where: { id: latest.id } })
        return reply.status(200).send({ data: { ...published, release: { id: result.release.id, number: result.release.number }, runs: result.gate.runs } })
      } catch (err) {
        return sendPublishError(reply, err)
      }
    }

    const published = await prisma.flowVersion.update({
      where: { id: latest.id },
      data: { status: 'published', environmentId, publishedAt: new Date() },
    })
    await prisma.activity.create({ data: { tenantId, userId: (request.user as JWT).sub, action: 'flow.published', resource: 'flow', resourceId: flowId, metadata: { version: latest.version, environmentId } } })
    const flow = await prisma.flow.findFirst({ where: { id: flowId, botId, tenantId }, select: { name: true } })
    if (flow) await attachDestination(botId, environmentId, flow.name).catch(() => {})
    return reply.status(200).send({ data: published })
  })

  app.get('/:botId/learn', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const query = z.object({ environmentId: z.string().min(1) }).safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Choose an environment.' } })
    const data = await learnSnapshot(botId, tenantId, query.data.environmentId)
    return { data }
  })

  app.post('/:botId/learn/samples', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      environmentId: z.string().min(1),
      text: z.string().min(1),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Paste a sample chat first.' } })
    const data = await learnFromSamples({ botId, tenantId, ...body.data })
    return { data }
  })

  app.post('/:botId/learn/rated', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ environmentId: z.string().min(1) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Choose an environment.' } })
    const data = await learnFromRated({ botId, tenantId, environmentId: body.data.environmentId })
    return { data }
  })

  app.post('/:botId/learn/publish', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      flowId: z.string().min(1),
      environmentId: z.string().min(1),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Choose the Sandbox draft to publish.' } })
    try {
      const data = await publishLearningDraft({ botId, tenantId, ...body.data })
      return { data }
    } catch (err) {
      if (err instanceof LearnError) return reply.status(err.status).send({ error: { code: 'LEARN', message: err.message } })
      throw err
    }
  })

  app.post('/:botId/learn/dismiss', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ flowId: z.string().min(1) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Choose the draft to dismiss.' } })
    try {
      await dismissLearningDraft({ botId, tenantId, flowId: body.data.flowId })
      return reply.status(204).send()
    } catch (err) {
      if (err instanceof LearnError) return reply.status(err.status).send({ error: { code: 'LEARN', message: err.message } })
      throw err
    }
  })
}
