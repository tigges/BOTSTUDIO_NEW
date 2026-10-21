import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@ybot/db'
import { requireRole } from '../middleware/auth.js'
import { z } from 'zod'
import { sendEmail, inviteEmail } from '../lib/email.js'
import { canRemoveWebChannel, ensureWebChannels } from '../lib/web-channels.js'
import { parseChannelConfig, channelWebhookPath, readAnalyticsQuery } from '@ybot/shared'
import { registerTelegramWebhook, verifyChannelCredentials } from '../lib/channel-verify.js'
import { summariseOutcomes } from '../lib/outcome-summary.js'
import { runAggregate } from '../lib/analytics-aggregate.js'

type JWT = { sub: string; tenantId: string; role: string }

export async function channelsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('SUPERVISOR', 'ADMIN'))

  app.get('/:botId/channels', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    await ensureWebChannels(tenantId, botId)
    return { data: await prisma.channel.findMany({ where: { botId, tenantId }, orderBy: { createdAt: 'asc' } }) }
  })

  app.post('/:botId/channels', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ name: z.string().min(1), kind: z.string(), environmentId: z.string(), config: z.record(z.any()).default({}) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const isActive = body.data.kind === 'web'
    if (body.data.kind !== 'web') {
      const parsed = parseChannelConfig(body.data.kind, body.data.config)
      if (!parsed) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Fill every field for this channel.' } })
      const check = await verifyChannelCredentials(body.data.kind, parsed)
      if (!check.ok) return reply.status(400).send({ error: { code: 'CHANNEL_VERIFY', message: check.message } })
      body.data.config = { ...parsed, ...(check.extra ?? {}) }
      const existing = await prisma.channel.findFirst({
        where: { botId, tenantId, kind: body.data.kind, environmentId: body.data.environmentId },
      })
      if (existing) return reply.status(409).send({ error: { code: 'CHANNEL_EXISTS', message: 'This channel is already connected.' } })
    }
    const created = await prisma.channel.create({ data: { ...body.data, tenantId, botId, isActive } })
    if (created.kind === 'telegram') {
      const parsed = parseChannelConfig(created.kind, created.config)
      if (parsed) {
        const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol ?? 'https').split(',')[0]?.trim() || 'https'
        const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? request.hostname).split(',')[0]?.trim()
        await registerTelegramWebhook(parsed, `${proto}://${host}${channelWebhookPath('telegram')}`)
      }
    }
    return reply.status(201).send({ data: created })
  })

  app.patch('/:botId/channels/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({ name: z.string().optional(), config: z.record(z.any()).optional(), isActive: z.boolean().optional(), allowedDomains: z.array(z.string()).optional() }).parse(request.body)
    const existing = await prisma.channel.findFirst({ where: { id, botId, tenantId } })
    if (!existing) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    if (existing.kind === 'web' && body.isActive === false) body.isActive = true
    if (body.config && existing.kind !== 'web') {
      const previous = typeof existing.config === 'object' && existing.config && !Array.isArray(existing.config)
        ? existing.config as Record<string, unknown>
        : {}
      const parsed = parseChannelConfig(existing.kind, { ...previous, ...body.config })
      if (!parsed) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Fill every field for this channel.' } })
      const check = await verifyChannelCredentials(existing.kind, parsed)
      if (!check.ok) return reply.status(400).send({ error: { code: 'CHANNEL_VERIFY', message: check.message } })
      body.config = { ...parsed, ...(check.extra ?? {}) }
    }
    const updated = await prisma.channel.updateMany({ where: { id, botId, tenantId }, data: body })
    if (existing.kind === 'telegram' && body.config) {
      const parsed = parseChannelConfig('telegram', body.config)
      if (parsed) {
        const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol ?? 'https').split(',')[0]?.trim() || 'https'
        const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? request.hostname).split(',')[0]?.trim()
        await registerTelegramWebhook(parsed, `${proto}://${host}${channelWebhookPath('telegram')}`)
      }
    }
    return { data: updated }
  })

  app.delete('/:botId/channels/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const channels = await prisma.channel.findMany({ where: { botId, tenantId }, select: { id: true, kind: true, environmentId: true } })
    if (!canRemoveWebChannel(channels, id)) {
      return reply.status(409).send({ error: { code: 'WEBCHAT_REQUIRED', message: 'Website chat stays on so guests can walk the journey.' } })
    }
    await prisma.channel.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })
}

export async function webhooksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('SUPERVISOR', 'ADMIN'))

  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const [rows, deliveries] = await Promise.all([
      prisma.webhook.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.webhookDelivery.groupBy({ by: ['webhookId', 'success'], where: { tenantId }, _count: true }),
    ])
    return {
      data: rows.map((row) => {
        const mine = deliveries.filter((d) => d.webhookId === row.id)
        const total = mine.reduce((sum, d) => sum + d._count, 0)
        const ok = mine.find((d) => d.success)?._count ?? 0
        return { ...row, secret: row.secret ? 'set' : null, successRate: total ? Math.round((ok / total) * 1000) / 10 : null }
      }),
    }
  })

  app.post('/probe', async (request, reply) => {
    const body = z.object({ url: z.string().url() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const start = Date.now()
    try {
      const res = await fetch(body.data.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-YBot-Event': 'webhook.test' },
        body: JSON.stringify({ event: 'webhook.test', data: { message: 'This is a test delivery from BotStudio.' } }),
        signal: AbortSignal.timeout(10_000),
      })
      return { data: { delivered: res.ok, statusCode: res.status, durationMs: Date.now() - start } }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed'
      return { data: { delivered: false, statusCode: 0, durationMs: Date.now() - start, error: msg } }
    }
  })

  app.post('/', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = z.object({ url: z.string().url(), events: z.array(z.string()).min(1), secret: z.string().optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const wh = await prisma.webhook.create({ data: { ...body.data, tenantId } })
    await prisma.activity.create({ data: { tenantId, userId: (request.user as JWT).sub, action: 'webhook.created', resource: 'webhook', resourceId: wh.id } })
    return reply.status(201).send({ data: wh })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = z.object({ url: z.string().url().optional(), events: z.array(z.string()).optional(), isActive: z.boolean().optional() }).parse(request.body)
    return { data: await prisma.webhook.updateMany({ where: { id, tenantId }, data: body }) }
  })

  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    await prisma.webhook.deleteMany({ where: { id, tenantId } })
    return reply.status(204).send()
  })

  // POST /webhooks/:id/test  — fire a real test delivery
  app.post('/:id/test', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const wh = await prisma.webhook.findFirst({ where: { id, tenantId } })
    if (!wh) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })

    const payload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      webhook: { id: wh.id, url: wh.url },
      data: { message: 'This is a test delivery from BotStudio.' },
    }

    const start = Date.now()
    let statusCode = 0
    let success = false
    let error: string | undefined
    try {
      const res = await fetch(wh.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-YBot-Event': 'webhook.test', 'X-YBot-Signature': `sha256=${id}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
      statusCode = res.status
      success = res.ok
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Request failed'
    }
    const durationMs = Date.now() - start
    await prisma.webhookDelivery.create({
      data: { tenantId, webhookId: wh.id, event: 'webhook.test', statusCode, success, durationMs, error },
    })
    return { data: { delivered: success, statusCode, durationMs, error } }
  })

  app.get('/:id/deliveries', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const wh = await prisma.webhook.findFirst({ where: { id, tenantId } })
    if (!wh) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const rows = await prisma.webhookDelivery.findMany({ where: { webhookId: id, tenantId }, orderBy: { createdAt: 'desc' }, take: 50 })
    return { data: rows }
  })
}

export async function teamRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.get('/members', async (request) => {
    const { tenantId } = request.user as JWT
    const members = await prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        locale: true,
        timezone: true,
        lastSeenAt: true,
        createdAt: true,
        memberships: true,
        agentProfile: true,
        _count: { select: { activities: true } },
      },
      orderBy: { displayName: 'asc' },
    })
    return { data: members }
  })

  app.post('/labels', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = z.object({ name: z.string().min(1), color: z.string().optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const label = await prisma.label.upsert({
      where: { tenantId_name: { tenantId, name: body.data.name } },
      create: { tenantId, name: body.data.name, color: body.data.color ?? '#94a3b8' },
      update: {},
    })
    return reply.status(201).send({ data: label })
  })

  // POST /team/invites
  app.post('/invites', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const { tenantId, sub: invitedById } = request.user as JWT
    const body = z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'SUPERVISOR', 'AGENT']).default('AGENT') }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    // Check if already a member
    const existing = await prisma.user.findFirst({ where: { tenantId, email: body.data.email } })
    if (existing) return reply.status(409).send({ error: { code: 'ALREADY_EXISTS', message: 'User already in workspace' } })
    // Create pending user (no passwordHash — they accept via the invite link)
    const invitedUser = await prisma.user.create({ data: { tenantId, email: body.data.email, displayName: body.data.email.split('@')[0] ?? body.data.email } })
    await prisma.membership.create({ data: { tenantId, userId: invitedUser.id, role: body.data.role } })

    const invitedByUser = await prisma.user.findUnique({ where: { id: invitedById } })
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })

    // Generate an invite JWT (no DB storage needed — signed with JWT_SECRET, expires 7d)
    const inviteToken = (app.jwt as unknown as { sign: (payload: unknown, opts: unknown) => string }).sign(
      { sub: invitedUser.id, type: 'invite' },
      { expiresIn: '7d' },
    )
    const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost'
    const inviteUrl = `${frontendUrl}/accept-invite?token=${inviteToken}`

    await sendEmail(inviteEmail({
      to: invitedUser.email,
      inviteUrl,
      invitedBy: invitedByUser?.displayName ?? invitedByUser?.email ?? 'A team member',
      workspaceName: tenant?.name ?? 'BotStudio',
      role: body.data.role,
    })).catch((e) => { console.error('[email] invite send failed:', e) })

    await prisma.activity.create({ data: { tenantId, userId: invitedById, action: 'user.invited', resource: 'user', resourceId: invitedUser.id, metadata: { role: body.data.role } } })
    return reply.status(201).send({ data: { id: invitedUser.id, email: invitedUser.email, role: body.data.role, status: 'invited' } })
  })

  // PATCH /team/members/:id/role
  app.patch('/members/:id/role', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const { tenantId, sub: changedBy } = request.user as JWT
    const { id } = request.params as { id: string }
    const { role } = request.body as { role: string }
    await prisma.membership.updateMany({ where: { userId: id, tenantId }, data: { role } })
    await prisma.activity.create({ data: { tenantId, userId: changedBy, action: 'user.role_changed', resource: 'user', resourceId: id, metadata: { role } } })
    return { data: { ok: true } }
  })

  // DELETE /team/members/:id
  app.delete('/members/:id', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    await prisma.membership.deleteMany({ where: { userId: id, tenantId } })
    await prisma.user.deleteMany({ where: { id, tenantId } })
    return reply.status(204).send()
  })

  // GET /team/labels
  app.get('/labels', async (request) => {
    const { tenantId } = request.user as JWT
    return { data: await prisma.label.findMany({ where: { tenantId } }) }
  })
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('SUPERVISOR', 'ADMIN'))

  // GET or POST /analytics/aggregate: metric, dimensions[], filters, range, granularity. Backs every dashboard widget.
  const aggregate = async (raw: Record<string, unknown>, tenantId: string, reply: FastifyReply) => {
    const query = readAnalyticsQuery(raw)
    if ('error' in query) return reply.status(400).send({ error: { code: 'VALIDATION', message: query.error } })
    return { data: await runAggregate(tenantId, query) }
  }
  app.get('/aggregate', async (request, reply) => aggregate(request.query as Record<string, unknown>, (request.user as JWT).tenantId, reply))
  app.post('/aggregate', async (request, reply) => aggregate((request.body ?? {}) as Record<string, unknown>, (request.user as JWT).tenantId, reply))

  // GET /analytics/overview?botId=...
  app.get('/overview', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const botId = q['botId']
    const where = { tenantId, ...(botId ? { botId } : {}) }

    const [totalConvos, resolvedConvos, escalatedConvos, totalContacts, csatRows, botHandledConvos] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.count({ where: { ...where, status: 'resolved' } }),
      prisma.conversation.count({ where: { ...where, status: 'escalated' } }),
      prisma.contact.count({ where: { tenantId } }),
      prisma.csatResponse.aggregate({ where: { tenantId }, _avg: { rating: true }, _count: { id: true } }),
      prisma.conversation.count({ where: { ...where, assignedTo: null } }),
    ])

    // Compute real avg response time: avg ms between a user message and the next bot reply
    type RespRow = { avg_ms: string | null }
    const respRows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<RespRow[]>)(
      botId
        ? `SELECT AVG(EXTRACT(EPOCH FROM (mb."createdAt" - mu."createdAt")) * 1000)::text AS avg_ms
           FROM messages mu
           JOIN LATERAL (
             SELECT "createdAt" FROM messages
             WHERE "conversationId" = mu."conversationId"
               AND "authorKind" = 'bot'
               AND "createdAt" > mu."createdAt"
             ORDER BY "createdAt" ASC LIMIT 1
           ) mb ON true
           WHERE mu."tenantId" = $1 AND mu."authorKind" = 'user'
             AND mu."tenantId" IN (SELECT "tenantId" FROM bots WHERE id = $2)`
        : `SELECT AVG(EXTRACT(EPOCH FROM (mb."createdAt" - mu."createdAt")) * 1000)::text AS avg_ms
           FROM messages mu
           JOIN LATERAL (
             SELECT "createdAt" FROM messages
             WHERE "conversationId" = mu."conversationId"
               AND "authorKind" = 'bot'
               AND "createdAt" > mu."createdAt"
             ORDER BY "createdAt" ASC LIMIT 1
           ) mb ON true
           WHERE mu."tenantId" = $1 AND mu."authorKind" = 'user'`,
      ...(botId ? [tenantId, botId] : [tenantId]),
    ).catch(() => [{ avg_ms: null }])

    const avgResponseTimeMs = respRows[0]?.avg_ms ? Math.round(parseFloat(respRows[0].avg_ms)) : null

    const llmSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [outcomeRows, llmTotals] = await Promise.all([
      prisma.conversation.groupBy({ by: ['outcome'], where, _count: { _all: true } }),
      prisma.llmCall.aggregate({
        where: { tenantId, createdAt: { gte: llmSince }, ...(botId ? { botId } : {}) },
        _sum: { costUsd: true },
        _count: { _all: true },
      }).catch(() => null),
    ])
    const outcomes = summariseOutcomes(outcomeRows.map((row) => ({ outcome: row.outcome, count: row._count._all })))

    const resolutionRate = totalConvos > 0 ? Math.round((resolvedConvos / totalConvos) * 100 * 10) / 10 : null
    const escalationRate = totalConvos > 0 ? Math.round((escalatedConvos / totalConvos) * 100 * 10) / 10 : null
    const botHandledPct = totalConvos > 0 ? Math.round((botHandledConvos / totalConvos) * 100) : null
    const avgRating = csatRows._avg.rating ?? 0
    const csatScore = csatRows._count.id > 0 ? Math.round(((avgRating + 1) / 2) * 100) : null

    return {
      data: {
        totalConversations: totalConvos,
        resolvedConversations: resolvedConvos,
        resolutionRate,
        escalationRate,
        totalContacts,
        csatScore,
        avgResponseTimeMs,
        botHandledPct,
        outcomes,
        llm: llmTotals
          ? { days: 30, calls: llmTotals._count._all, costUsd: llmTotals._count._all > 0 ? llmTotals._sum.costUsd ?? 0 : null }
          : null,
      }
    }
  })

  // GET /analytics/llm-calls?conversationId=&botId=&source=&limit= — one row per model call (raw tier)
  app.get('/llm-calls', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const limit = Math.min(Math.max(parseInt(q['limit'] ?? '100', 10) || 100, 1), 500)
    const rows = await prisma.llmCall.findMany({
      where: {
        tenantId,
        ...(q['conversationId'] ? { conversationId: q['conversationId'] } : {}),
        ...(q['botId'] ? { botId: q['botId'] } : {}),
        ...(q['source'] ? { source: q['source'] } : {}),
        ...(q['environment'] ? { environment: q['environment'] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return { data: rows }
  })

  // GET /analytics/conversations?botId=...&days=7
  app.get('/conversations', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const botId = q['botId']
    const days = Math.min(Math.max(parseInt(q['days'] ?? '7', 10), 1), 90)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    type TrendRow = { day: Date; conversations: string; resolved: string; escalated: string }
    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<TrendRow[]>)(
      botId
        ? `SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::text AS conversations,
             SUM(CASE WHEN outcome LIKE 'contained%' THEN 1 ELSE 0 END)::text AS resolved,
             SUM(CASE WHEN outcome='escalated' THEN 1 ELSE 0 END)::text AS escalated
           FROM conversations WHERE "tenantId"=$1 AND "botId"=$2 AND "createdAt">=$3
           GROUP BY 1 ORDER BY 1 ASC`
        : `SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::text AS conversations,
             SUM(CASE WHEN outcome LIKE 'contained%' THEN 1 ELSE 0 END)::text AS resolved,
             SUM(CASE WHEN outcome='escalated' THEN 1 ELSE 0 END)::text AS escalated
           FROM conversations WHERE "tenantId"=$1 AND "createdAt">=$2
           GROUP BY 1 ORDER BY 1 ASC`,
      ...(botId ? [tenantId, botId, since] : [tenantId, since]),
    )

    return {
      data: rows.map((row) => ({
        date: new Date(row.day).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
        conversations: parseInt(row.conversations, 10),
        resolved: parseInt(row.resolved, 10),
        escalated: parseInt(row.escalated, 10),
      }))
    }
  })

  // GET /analytics/csat-trend?days=30
  app.get('/csat-trend', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const days = Math.min(Math.max(parseInt(q['days'] ?? '30', 10), 1), 90)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    type CsatRow = { day: Date; positive: string; negative: string }
    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<CsatRow[]>)(
      `SELECT date_trunc('day', "createdAt") AS day,
         SUM(CASE WHEN rating=1  THEN 1 ELSE 0 END)::text AS positive,
         SUM(CASE WHEN rating=-1 THEN 1 ELSE 0 END)::text AS negative
       FROM csat_responses
       WHERE "tenantId"=$1 AND "createdAt">=$2
       GROUP BY 1 ORDER BY 1 ASC`,
      tenantId, since,
    )

    return {
      data: rows.map((r) => {
        const pos = parseInt(r.positive, 10)
        const neg = parseInt(r.negative, 10)
        const total = pos + neg
        return {
          date: new Date(r.day).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
          score: total > 0 ? Math.round((pos / total) * 100) : 0,
          positive: pos,
          negative: neg,
        }
      })
    }
  })

  // GET /analytics/resolution-breakdown
  app.get('/resolution-breakdown', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const botId = q['botId']
    const where = { tenantId, ...(botId ? { botId } : {}) }

    const rows = await prisma.conversation.groupBy({ by: ['outcome'], where, _count: { _all: true } })
    const outcomes = summariseOutcomes(rows.map((row) => ({ outcome: row.outcome, count: row._count._all })))

    return {
      data: [
        { name: 'Contained', value: outcomes.buckets.contained },
        { name: 'Escalated', value: outcomes.buckets.escalated },
        { name: 'Abandoned', value: outcomes.buckets.abandoned },
      ],
      finished: outcomes.finished,
      open: outcomes.open,
    }
  })

  // GET /analytics/response-time-by-hour
  app.get('/response-time-by-hour', async (request) => {
    const { tenantId } = request.user as JWT

    type HourRow = { hour: number; avg_ms: string }
    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<HourRow[]>)(
      `SELECT EXTRACT(HOUR FROM mu."createdAt")::int AS hour,
         AVG(EXTRACT(EPOCH FROM (mb."createdAt" - mu."createdAt")) * 1000)::text AS avg_ms
       FROM messages mu
       JOIN LATERAL (
         SELECT "createdAt" FROM messages
         WHERE "conversationId" = mu."conversationId"
           AND "authorKind" = 'bot'
           AND "createdAt" > mu."createdAt"
         ORDER BY "createdAt" ASC LIMIT 1
       ) mb ON true
       WHERE mu."tenantId" = $1 AND mu."authorKind" = 'user'
       GROUP BY 1 ORDER BY 1 ASC`,
      tenantId,
    ).catch(() => [] as HourRow[])

    // Fill all 24 hours, default 0 for missing
    const byHour = new Map(rows.map((r) => [r.hour, Math.round(parseFloat(r.avg_ms) / 1000)]))
    return {
      data: Array.from({ length: 24 }, (_, h) => ({
        hour: `${String(h).padStart(2, '0')}:00`,
        time: byHour.get(h) ?? 0,
      }))
    }
  })

  // GET /analytics/agents — per-agent resolution stats
  app.get('/agents', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const days = Math.min(Math.max(parseInt(q['days'] ?? '30', 10), 1), 90)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    type AgentRow = { agentId: string; name: string; total: string; resolved: string; escalated: string }
    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<AgentRow[]>)(
      `SELECT c."assignedTo" AS "agentId", u."displayName" AS name,
         COUNT(*)::text AS total,
         SUM(CASE WHEN c.status='resolved' THEN 1 ELSE 0 END)::text AS resolved,
         SUM(CASE WHEN c.status='escalated' THEN 1 ELSE 0 END)::text AS escalated
       FROM conversations c
       LEFT JOIN users u ON u.id=c."assignedTo"
       WHERE c."tenantId"=$1 AND c."createdAt">=$2 AND c."assignedTo" IS NOT NULL
       GROUP BY 1, 2 ORDER BY total DESC LIMIT 10`,
      tenantId, since,
    )
    return {
      data: rows.map((r) => ({
        agentId: r.agentId, name: r.name ?? 'Unknown',
        total: parseInt(r.total, 10),
        resolved: parseInt(r.resolved, 10),
        escalated: parseInt(r.escalated, 10),
        resolutionRate: parseInt(r.total, 10) > 0 ? Math.round((parseInt(r.resolved, 10) / parseInt(r.total, 10)) * 100) : 0,
      }))
    }
  })

  // GET /analytics/channels — conversation volume per channel
  app.get('/channels', async (request) => {
    const { tenantId } = request.user as JWT
    type ChanRow = { channelId: string; name: string; total: string }
    const rows = await (prisma.$queryRawUnsafe as (sql: string, ...p: unknown[]) => Promise<ChanRow[]>)(
      `SELECT c."channelId", ch.name, COUNT(*)::text AS total
       FROM conversations c
       LEFT JOIN channels ch ON ch.id=c."channelId"
       WHERE c."tenantId"=$1
       GROUP BY 1, 2 ORDER BY total DESC LIMIT 10`,
      tenantId,
    )
    return {
      data: rows.map((r) => ({ channelId: r.channelId, name: r.name ?? 'Unknown', total: parseInt(r.total, 10) }))
    }
  })
}

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('ADMIN'))

  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const where: Record<string, unknown> = { tenantId }
    if (q['action']) where['action'] = { contains: q['action'] }
    if (q['userId']) where['userId'] = q['userId']

    const events = await prisma.activity.findMany({
      where,
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: parseInt(q['limit'] ?? '100'),
      skip: parseInt(q['offset'] ?? '0'),
    })
    return { data: events }
  })
}
