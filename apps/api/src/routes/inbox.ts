import type { FastifyInstance } from 'fastify'
import { prisma } from '@ybot/db'
import { z } from 'zod'
import { processInboundMessage } from '../runtime-bridge.js'
import { enqueueConversationAnalysis } from '../queues.js'
import { triggerRules } from '../lib/automation-engine.js'
import { attachSlaLabels, onOutboundReply } from '../lib/sla.js'
import { presentConversation, presentMessages } from '../lib/present-chat.js'
import { outcomeAfterStatus } from '../lib/chat-outcome.js'
import { costByConversation } from '../lib/llm-ledger.js'
import { deliverAgentReply, returnChat } from '../lib/handover.js'
import { RETURN_OUTCOMES } from '@ybot/shared'

type JWT = { sub: string; tenantId: string; role: string }

export async function conversationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  // POST /conversations — create a new conversation (agent-initiated or test)
  app.post('/', async (request, reply) => {
    const { tenantId, sub: userId } = request.user as JWT
    const body = z.object({
      botId: z.string().min(1),
      channelId: z.string().optional(),
      contactId: z.string().optional(),
      environmentId: z.string().optional(),
      message: z.string().min(1).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    const bot = await prisma.bot.findFirst({ where: { id: body.data.botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })

    const env = body.data.environmentId
      ? await prisma.environment.findFirst({ where: { id: body.data.environmentId, botId: body.data.botId } })
      : await prisma.environment.findFirst({ where: { botId: body.data.botId, kind: 'sandbox' } })
        ?? await prisma.environment.findFirst({ where: { botId: body.data.botId } })
    if (!env) return reply.status(422).send({ error: { code: 'NO_ENVIRONMENT', message: 'Bot has no environment' } })

    const convo = await prisma.conversation.create({
      data: {
        tenantId,
        botId: body.data.botId,
        environmentId: env.id,
        channelId: body.data.channelId,
        contactId: body.data.contactId,
        assignedTo: userId,
        status: 'active',
      },
      include: {
        contact: true,
        channel: { select: { id: true, name: true, kind: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        labels: { include: { label: true } },
        _count: { select: { messages: true } },
      },
    })

    if (body.data.message) {
      await prisma.message.create({
        data: {
          tenantId,
          conversationId: convo.id,
          direction: 'inbound',
          authorKind: 'agent',
          authorId: userId,
          content: { text: body.data.message },
        },
      })
    }

    // Broadcast WS event so Inbox updates in real-time
    try { (app as unknown as { broadcastToTenant(tid: string, e: object): void }).broadcastToTenant(tenantId, { event: 'conversation.created', data: convo }) } catch { /* ignore */ }

    return reply.status(201).send({ data: convo })
  })

  // GET /conversations  (with filters)
  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const conversations = await prisma.conversation.findMany({
      where: {
        tenantId,
        ...(q['botId'] ? { botId: q['botId'] } : {}),
        ...(q['status'] ? { status: q['status'] } : {}),
        ...(q['assignedTo'] ? { assignedTo: q['assignedTo'] } : {}),
        ...(q['channelId'] ? { channelId: q['channelId'] } : {}),
        ...(q['contactId'] ? { contactId: q['contactId'] } : {}),
      },
      include: {
        contact: true,
        channel: { select: { id: true, name: true, kind: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        labels: { include: { label: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: parseInt(q['limit'] ?? '50'),
      skip: parseInt(q['offset'] ?? '0'),
    })
    const data = await attachSlaLabels(conversations).catch(() => conversations.map((c) => ({ ...c, sla: null as string | null })))
    const costs = await costByConversation(data.map((c) => c.id)).catch(() => new Map())
    return { data: data.map((conversation) => ({ ...presentConversation(conversation), llm: costs.get(conversation.id) ?? null })) }
  })

  // GET /conversations/:id
  app.get('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const convo = await prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { contact: true, channel: true, messages: { orderBy: { createdAt: 'asc' } }, labels: { include: { label: true } }, tickets: true },
    })
    if (!convo) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const [labeled] = await attachSlaLabels([convo]).catch(() => [{ ...convo, sla: null as string | null }])
    const costs = await costByConversation([convo.id]).catch(() => new Map())
    return { data: { ...(labeled ? presentConversation(labeled) : convo), llm: costs.get(convo.id) ?? null } }
  })

  // PATCH /conversations/:id  (assign, resolve, escalate, etc.)
  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = z.object({
      status: z.enum(['active', 'resolved', 'escalated', 'closed']).optional(),
      assignedTo: z.string().nullable().optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const before = await prisma.conversation.findFirst({ where: { id, tenantId }, select: { assignedTo: true, outcome: true } })
    const outcome = before
      ? outcomeAfterStatus(body.data.status, body.data.assignedTo !== undefined ? body.data.assignedTo : before.assignedTo, before.outcome)
      : undefined
    const convo = await prisma.conversation.updateMany({
      where: { id, tenantId },
      data: {
        ...body.data,
        ...(body.data.status === 'resolved' ? { resolvedAt: new Date() } : {}),
        ...(outcome !== undefined ? { outcome } : {}),
      },
    })

    // Trigger quality analysis for resolved conversations
    if (body.data.status === 'resolved') {
      const full = await prisma.conversation.findFirst({ where: { id, tenantId } })
      if (full) {
        enqueueConversationAnalysis({ conversationId: id, tenantId, botId: full.botId }).catch(() => {})
        triggerRules('conversation.resolved', {
          tenantId, botId: full.botId, conversationId: id, conversationStatus: 'resolved',
        }).catch(() => {})
      }
    }

    if (body.data.status === 'escalated') {
      const full = await prisma.conversation.findFirst({ where: { id, tenantId } })
      if (full) {
        triggerRules('conversation.escalated', {
          tenantId, botId: full.botId, conversationId: id, conversationStatus: 'escalated',
        }).catch(() => {})
      }
    }

    return { data: convo }
  })

  // GET /conversations/:id/messages
  app.get('/:id/messages', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const exists = await prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { contact: { select: { displayName: true } } },
    })
    if (!exists) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    const messages = await prisma.message.findMany({ where: { conversationId: id, tenantId }, orderBy: { createdAt: 'asc' } })
    return { data: presentMessages(messages, exists.contact?.displayName) }
  })

  // POST /conversations/:id/messages  (agent reply or inbound user message)
  app.post('/:id/messages', async (request, reply) => {
    const { tenantId, sub: userId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = z.object({
      content: z.object({ text: z.string().min(1) }),
      authorKind: z.enum(['agent', 'bot', 'user']).default('agent'),
      isInternalNote: z.boolean().default(false),
      direction: z.enum(['inbound', 'outbound']).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })

    const direction = body.data.direction ?? (body.data.authorKind === 'user' ? 'inbound' : 'outbound')
    const msg = await prisma.message.create({
      data: {
        tenantId,
        conversationId: id,
        direction,
        authorId: userId,
        authorKind: body.data.authorKind,
        content: { ...body.data.content, internal: body.data.isInternalNote },
      },
    })
    await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } })
    let delivery: 'sent' | 'widget' | 'none' | 'failed' | undefined
    if (direction === 'outbound' && !body.data.isInternalNote) {
      await onOutboundReply(id).catch(() => {})
    }
    if (direction === 'outbound' && body.data.authorKind === 'agent' && !body.data.isInternalNote) {
      await prisma.conversation.updateMany({
        where: { id, tenantId, assignedTo: null, status: { in: ['active', 'escalated'] } },
        data: { assignedTo: userId },
      }).catch(() => {})
      delivery = await deliverAgentReply(id, body.data.content.text).catch((err) => {
        request.log.warn({ err, conversationId: id }, 'agent reply was not delivered to the channel')
        return 'failed' as const
      })
    }

    // Trigger bot engine for inbound user messages
    if (direction === 'inbound' && body.data.authorKind === 'user') {
      // Fire-and-forget: don't await — respond immediately, bot replies come via WS
      setImmediate(() => processInboundMessage(app, id, tenantId, body.data.content.text).catch(() => {}))
    }

    return reply.status(201).send({ data: msg, ...(delivery ? { delivery } : {}) })
  })

  // POST /conversations/:id/return — a person hands the chat back: resolved, back to the bot, or needs follow-up
  app.post('/:id/return', async (request, reply) => {
    const { tenantId, sub: userId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = z.object({
      outcome: z.enum(RETURN_OUTCOMES),
      note: z.string().max(1000).optional(),
    }).safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Pick resolved, needs_bot or needs_follow_up as the outcome.', details: body.error.flatten() } })
    }
    const result = await returnChat({ conversationId: id, tenantId, outcome: body.data.outcome, note: body.data.note, userId })
    if (!result) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } })
    return { data: result }
  })

  // POST /conversations/:id/labels
  app.post('/:id/labels', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const { labelId } = request.body as { labelId: string }
    const label = await prisma.label.findFirst({ where: { id: labelId, tenantId } })
    if (!label) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    await prisma.conversationLabel.upsert({ where: { conversationId_labelId: { conversationId: id, labelId } }, create: { conversationId: id, labelId }, update: {} })
    return reply.status(200).send({ data: { ok: true } })
  })

  // DELETE /conversations/:id/labels/:labelId
  app.delete('/:id/labels/:labelId', async (request, reply) => {
    const { id, labelId } = request.params as { id: string; labelId: string }
    await prisma.conversationLabel.delete({ where: { conversationId_labelId: { conversationId: id, labelId } } })
    return reply.status(204).send()
  })
}

export async function ticketsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    return { data: await prisma.ticket.findMany({
      where: { tenantId, ...(q['status'] ? { status: q['status'] } : {}), ...(q['assignedTo'] ? { assignedTo: q['assignedTo'] } : {}) },
      include: { conversation: { include: { contact: true } } },
      orderBy: { createdAt: 'desc' },
    })}
  })

  app.post('/', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = z.object({
      conversationId: z.string().optional(),
      subject: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(['low', 'normal', 'medium', 'high', 'urgent', 'critical']).default('medium'),
      assignedTo: z.string().optional(),
      tags: z.array(z.string()).default([]),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const priority = ({ low: 'low', normal: 'medium', medium: 'medium', high: 'high', urgent: 'critical', critical: 'critical' } as const)[body.data.priority]
    return reply.status(201).send({ data: await prisma.ticket.create({ data: { ...body.data, priority, tenantId } }) })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = z.object({ status: z.string().optional(), priority: z.string().optional(), assignedTo: z.string().nullable().optional(), tags: z.array(z.string()).optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const data: Record<string, unknown> = { ...body.data }
    if (body.data.status === 'resolved') data['resolvedAt'] = new Date()
    return { data: await prisma.ticket.updateMany({ where: { id, tenantId }, data }) }
  })

  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    await prisma.ticket.deleteMany({ where: { id, tenantId } })
    return reply.status(204).send()
  })
}

export async function contactsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/export', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const rows = await prisma.contact.findMany({ where: { tenantId }, orderBy: { displayName: 'asc' } })
    const csv = ['name,email,phone', ...rows.map((r) => [r.displayName, r.email, r.phone].map((value) => {
      const text = value ?? ''
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }).join(','))].join('\n')
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    return reply.send(csv)
  })

  app.post('/import', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = z.object({
      contacts: z.array(z.object({
        displayName: z.string().min(1),
        email: z.string().email().optional().or(z.literal('')),
        phone: z.string().optional(),
      })).min(1),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const created = await prisma.contact.createMany({
      data: body.data.contacts.map((row) => ({
        tenantId,
        displayName: row.displayName,
        email: row.email || undefined,
        phone: row.phone || undefined,
      })),
    })
    return reply.status(201).send({ data: { created: created.count } })
  })

  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const q = request.query as Record<string, string>
    const where: Record<string, unknown> = { tenantId }
    if (q['search']) where['OR'] = [{ displayName: { contains: q['search'], mode: 'insensitive' } }, { email: { contains: q['search'], mode: 'insensitive' } }]
    return { data: await prisma.contact.findMany({ where, include: { _count: { select: { conversations: true } } }, orderBy: { createdAt: 'desc' }, take: parseInt(q['limit'] ?? '100') }) }
  })

  app.post('/', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = z.object({ displayName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), metadata: z.record(z.any()).default({}) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    return reply.status(201).send({ data: await prisma.contact.create({ data: { ...body.data, tenantId } }) })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = z.object({ displayName: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(), metadata: z.record(z.any()).optional() }).parse(request.body)
    return { data: await prisma.contact.updateMany({ where: { id, tenantId }, data: body }) }
  })

  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    await prisma.contact.deleteMany({ where: { id, tenantId } })
    return reply.status(204).send()
  })
}
