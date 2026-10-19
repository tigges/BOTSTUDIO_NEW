/**
 * Production releases.
 *
 * GET  /api/v1/bots/:botId/releases               releases, which one is live, and what publishing would change
 * POST /api/v1/bots/:botId/releases               { note? } publish the working copy (checks + gate suites)
 * POST /api/v1/bots/:botId/releases/:id/rollback  make an older release live again
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@ybot/db'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { listReleases, productionEnvironment, releaseCandidate, ReleaseError, rollback } from '../lib/releases.js'
import { publishToProduction, PublishBlocked } from '../lib/publish.js'

type JWT = { sub: string; tenantId: string; role: string }

export function sendPublishError(reply: FastifyReply, err: unknown) {
  if (err instanceof PublishBlocked) {
    return reply.status(422).send({ error: { code: err.code, message: err.message, ...err.details } })
  }
  if (err instanceof ReleaseError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message } })
  }
  throw err
}

export async function releasesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/releases', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    try {
      const environment = await productionEnvironment(botId, tenantId)
      const [releases, candidate, gateSuites] = await Promise.all([
        listReleases(botId, environment.id, environment.liveReleaseId),
        releaseCandidate(botId, environment.id),
        prisma.evalSuite.count({ where: { botId, tenantId, gate: true } }),
      ])
      return {
        data: {
          environmentId: environment.id,
          liveReleaseId: environment.liveReleaseId,
          plays: environment.liveReleaseId ? 'release' : 'working_copy',
          releases,
          pending: candidate.diff,
          gateSuites,
        },
      }
    } catch (err) {
      return sendPublishError(reply, err)
    }
  })

  app.post('/:botId/releases', async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ note: z.string().max(280).optional() }).safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Keep the note under 280 characters.' } })
    try {
      const environment = await productionEnvironment(botId, tenantId)
      const result = await publishToProduction({ tenantId, botId, environmentId: environment.id, note: body.data.note, userId: sub })
      await prisma.activity.create({ data: { tenantId, userId: sub, action: 'release.published', resource: 'bot', resourceId: botId, metadata: { number: result.release.number, environmentId: environment.id } } }).catch(() => {})
      return reply.status(201).send({ data: { releaseId: result.release.id, number: result.release.number, diff: result.diff, runs: result.gate.runs } })
    } catch (err) {
      return sendPublishError(reply, err)
    }
  })

  app.post('/:botId/releases/:id/rollback', async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    try {
      const release = await rollback({ botId, tenantId, releaseId: id })
      await prisma.activity.create({ data: { tenantId, userId: sub, action: 'release.rolled_back', resource: 'bot', resourceId: botId, metadata: { number: release.number, environmentId: release.environmentId } } }).catch(() => {})
      return { data: { releaseId: release.id, number: release.number } }
    } catch (err) {
      return sendPublishError(reply, err)
    }
  })
}
