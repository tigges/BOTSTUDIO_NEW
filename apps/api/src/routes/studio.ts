import type { FastifyInstance } from 'fastify'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import { CONNECTORS, isConnector } from '@botstudio/shared'
import { requireRole } from '../middleware/auth.js'
import { IntegrationError, connectIntegration, connectionGaps, disconnectIntegration, installConnectorTools } from '../lib/integrations.js'

type JWT = { sub: string; tenantId: string; role: string }

const DEFAULT_CANNED = [
  { shortcut: 'hello', title: 'Greeting', text: 'Hi! How can I help you today?' },
  { shortcut: 'thanks', title: 'Thanks', text: 'Thanks for reaching out. I am looking into this now.' },
  { shortcut: 'hours', title: 'Hours', text: 'Our team is available 09:00–18:00 Europe/London. I can still help here.' },
  { shortcut: 'wait', title: 'Please wait', text: 'Give me a moment while I check that for you.' },
  { shortcut: 'bye', title: 'Goodbye', text: 'Glad I could help. Reply here if you need anything else.' },
]

export const INTEGRATION_CATALOG = [
  { id: 'hubspot', name: 'HubSpot', description: 'Sync contacts and conversations to HubSpot CRM', category: 'CRM' },
  { id: 'salesforce', name: 'Salesforce', description: 'Push leads and cases to Salesforce automatically', category: 'CRM' },
  { id: 'zendesk', name: 'Zendesk', description: 'Create and sync Zendesk tickets from conversations', category: 'Ticketing' },
  { id: 'jira', name: 'Jira', description: 'Create Jira issues directly from chat escalations', category: 'Ticketing' },
  { id: 'slack', name: 'Slack', description: 'Post conversation alerts and reports to Slack channels', category: 'Messaging' },
  { id: 'teams', name: 'Microsoft Teams', description: 'Send notifications and alerts to Teams channels', category: 'Messaging' },
  { id: 'zapier', name: 'Zapier', description: 'Connect BotStudio to 5000+ apps via Zapier workflows', category: 'Automation' },
  { id: 'n8n', name: 'n8n', description: 'Self-hosted automation workflows with n8n', category: 'Automation' },
  { id: 'ga4', name: 'Google Analytics', description: 'Track bot engagement and conversion events in GA4', category: 'Analytics' },
  { id: 'mixpanel', name: 'Mixpanel', description: 'Send custom events to Mixpanel for product analytics', category: 'Analytics' },
  { id: 'shopify', name: 'Shopify', description: 'Look up orders, products, and customers from Shopify', category: 'Commerce' },
  { id: 'stripe', name: 'Stripe', description: 'Retrieve payment and subscription data from Stripe', category: 'Commerce' },
  { id: 'phorest', name: 'Phorest', description: 'Send an already confirmed booking to Phorest. The guest stays in chat until then.', category: 'Booking' },
] as const

const COMING_SOON = new Set<string>(['stripe', 'phorest'])

export async function cannedRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const existing = await prisma.cannedReply.count({ where: { tenantId } })
    if (existing === 0) {
      await prisma.cannedReply.createMany({
        data: DEFAULT_CANNED.map((row) => ({ ...row, tenantId })),
      })
    }
    return { data: await prisma.cannedReply.findMany({ where: { tenantId }, orderBy: { shortcut: 'asc' } }) }
  })

  app.post('/', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = z.object({
      shortcut: z.string().min(1).max(40),
      title: z.string().min(1),
      text: z.string().min(1),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const shortcut = body.data.shortcut.replace(/^\//, '').trim()
    const row = await prisma.cannedReply.create({ data: { tenantId, shortcut, title: body.data.title, text: body.data.text } })
    return reply.status(201).send({ data: row })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = z.object({ shortcut: z.string().min(1).optional(), title: z.string().min(1).optional(), text: z.string().min(1).optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const updated = await prisma.cannedReply.updateMany({ where: { id, tenantId }, data: body.data })
    if (!updated.count) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    return { data: updated }
  })

  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    await prisma.cannedReply.deleteMany({ where: { id, tenantId } })
    return reply.status(204).send()
  })
}

export async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/reports', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const rows = await prisma.report.findMany({ where: { tenantId, botId }, orderBy: { createdAt: 'desc' } })
    return { data: rows.map(presentReport) }
  })

  app.post('/:botId/reports', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      name: z.string().min(1),
      type: z.string().default('Conversation'),
      format: z.string().default('csv'),
      frequency: z.string().default('one-time'),
      recipients: z.array(z.string()).default([]),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const row = await prisma.report.create({
      data: {
        tenantId,
        botId,
        name: body.data.name,
        schedule: body.data.frequency,
        query: { type: body.data.type, format: body.data.format, recipients: body.data.recipients, status: 'scheduled' },
      },
    })
    return reply.status(201).send({ data: presentReport(row) })
  })

  app.post('/:botId/reports/:id/run', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const row = await prisma.report.findFirst({ where: { id, botId, tenantId } })
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const query = (row.query ?? {}) as Record<string, unknown>
    const updated = await prisma.report.update({
      where: { id: row.id },
      data: { lastRunAt: new Date(), query: { ...query, status: 'ready' } },
    })
    return { data: presentReport(updated) }
  })

  app.get('/:botId/reports/:id/download', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const row = await prisma.report.findFirst({ where: { id, botId, tenantId } })
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const query = (row.query ?? {}) as { type?: string }
    const csv = await reportCsv(tenantId, botId, query.type ?? 'Conversation')
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${row.name.replace(/[^a-z0-9]+/gi, '-')}.csv"`)
    return reply.send(csv)
  })

  app.delete('/:botId/reports/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    await prisma.report.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })
}

function presentReport(row: { id: string; name: string; query: unknown; schedule: string | null; lastRunAt: Date | null; createdAt: Date }) {
  const query = (row.query ?? {}) as { type?: string; format?: string; recipients?: string[]; status?: string }
  return {
    id: row.id,
    name: row.name,
    type: query.type ?? 'Conversation',
    format: query.format ?? 'csv',
    frequency: row.schedule ?? 'one-time',
    status: query.status ?? (row.lastRunAt ? 'ready' : 'scheduled'),
    recipients: query.recipients ?? [],
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

async function reportCsv(tenantId: string, botId: string, type: string) {
  if (type.toLowerCase().includes('contact')) {
    const rows = await prisma.contact.findMany({ where: { tenantId }, take: 500, orderBy: { createdAt: 'desc' } })
    return ['name,email,phone', ...rows.map((r) => [r.displayName, r.email ?? '', r.phone ?? ''].map(csv).join(','))].join('\n')
  }
  const rows = await prisma.conversation.findMany({
    where: { tenantId, botId },
    include: { contact: true, channel: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  return ['id,contact,channel,status,updated', ...rows.map((r) => [r.id, r.contact?.displayName ?? '', r.channel?.name ?? '', r.status, r.updatedAt.toISOString()].map(csv).join(','))].join('\n')
}

function csv(value: string | null | undefined) {
  const text = value ?? ''
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const DEFAULT_COLUMNS = [
  { name: 'id', type: 'pk', nullable: false },
  { name: 'name', type: 'text', nullable: false },
]

export async function databaseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/tables', async (request) => {
    const { tenantId } = request.user as JWT
    const tables = await prisma.dataTable.findMany({
      where: { tenantId },
      include: { _count: { select: { records: true } } },
      orderBy: { name: 'asc' },
    })
    return {
      data: tables.map((t) => ({
        id: t.id,
        name: t.name,
        columns: t.columns,
        rows: t._count.records,
        updatedAt: t.updatedAt.toISOString(),
      })),
    }
  })

  app.post('/tables', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = z.object({
      name: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
      columns: z.array(z.object({ name: z.string(), type: z.string(), nullable: z.boolean().optional() })).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const table = await prisma.dataTable.create({
      data: { tenantId, name: body.data.name, columns: body.data.columns ?? DEFAULT_COLUMNS },
    })
    return reply.status(201).send({ data: { id: table.id, name: table.name, columns: table.columns, rows: 0, updatedAt: table.updatedAt.toISOString() } })
  })

  app.get('/tables/:id/records', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const table = await prisma.dataTable.findFirst({ where: { id, tenantId } })
    if (!table) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const records = await prisma.dataRecord.findMany({ where: { tableId: id, tenantId }, orderBy: { createdAt: 'desc' }, take: 200 })
    return { data: records.map((r) => ({ id: r.id, ...(r.data as object) })) }
  })

  app.post('/tables/:id/records', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const table = await prisma.dataTable.findFirst({ where: { id, tenantId } })
    if (!table) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const body = z.object({ data: z.record(z.any()) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const data = { ...body.data.data, id: '' }
    const record = await prisma.dataRecord.create({ data: { tenantId, tableId: id, data } })
    const stored = { ...body.data.data, id: record.id }
    await prisma.dataRecord.update({ where: { id: record.id }, data: { data: stored } })
    return reply.status(201).send({ data: stored })
  })

  app.delete('/tables/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    await prisma.dataTable.deleteMany({ where: { id, tenantId } })
    return reply.status(204).send()
  })
}

export async function integrationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const saved = await prisma.integrationConnection.findMany({
      where: { tenantId },
      include: { authProfile: { select: { id: true, name: true, secretEnc: true, secretHint: true } } },
    })
    const byProvider = new Map(saved.map((row) => [row.provider, row]))
    return {
      data: INTEGRATION_CATALOG.map((item) => {
        const row = byProvider.get(item.id)
        const comingSoon = COMING_SOON.has(item.id)
        const hasKey = Boolean(row?.authProfile?.secretEnc)
        const gaps = row ? connectionGaps(item.id, row.settings, hasKey) : []
        const spec = isConnector(item.id) ? CONNECTORS[item.id] : null
        return {
          ...item,
          status: comingSoon ? 'coming_soon' : !row ? 'available' : gaps.length ? 'needs_details' : 'connected',
          connectedAt: row?.connectedAt.toISOString() ?? null,
          hasKey,
          gaps,
          settings: (row?.settings ?? {}) as Record<string, unknown>,
          authProfile: row?.authProfile ? { id: row.authProfile.id, name: row.authProfile.name, secretHint: row.authProfile.secretHint } : null,
          connector: spec ? { fields: spec.fields, secretLabel: spec.secretLabel, secretHelp: spec.secretHelp, hasTools: true } : null,
        }
      }),
    }
  })

  app.post('/:provider/connect', async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { provider } = request.params as { provider: string }
    const item = INTEGRATION_CATALOG.find((entry) => entry.id === provider)
    if (!item) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This connection is not in the catalog.' } })
    if (COMING_SOON.has(provider)) {
      return reply.status(409).send({ error: { code: 'COMING_SOON', message: 'This connection will become a real feature.' } })
    }
    const body = z.object({
      secret: z.string().max(8_000).optional(),
      apiKey: z.string().max(8_000).optional(),
      settings: z.record(z.unknown()).default({}),
    }).safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    try {
      const { connection, profile } = await connectIntegration({
        tenantId, userId: sub, item, secret: body.data.secret ?? body.data.apiKey, settings: body.data.settings,
      })
      return {
        data: {
          provider: connection.provider,
          status: 'connected',
          connectedAt: connection.connectedAt.toISOString(),
          authProfile: { id: profile.id, name: profile.name, secretHint: profile.secretHint },
        },
      }
    } catch (err) {
      if (err instanceof IntegrationError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, issues: err.issues } })
      throw err
    }
  })

  app.post('/:provider/install', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { provider } = request.params as { provider: string }
    const body = z.object({ botId: z.string().min(1) }).safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Choose the bot to add the tools to.' } })
    try {
      return reply.status(201).send({ data: await installConnectorTools(tenantId, body.data.botId, provider) })
    } catch (err) {
      if (err instanceof IntegrationError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, issues: err.issues } })
      throw err
    }
  })

  app.delete('/:provider', async (request) => {
    const { tenantId } = request.user as JWT
    const { provider } = request.params as { provider: string }
    return { data: await disconnectIntegration(tenantId, provider) }
  })
}
