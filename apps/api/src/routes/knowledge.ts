import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import { DEFAULT_MODELS } from '@botstudio/llm'
import { BackgroundJobsUnavailableError, enqueueKnowledgeSync } from '../queues.js'
import { extractTextFromBuffer } from '../lib/extract-text.js'
import { rereadWebsitePages } from '../lib/reread-website.js'
import { enterLlmScope } from '../lib/llm-ledger.js'
import { readPublicSite } from '../lib/public-site.js'
import { BUSINESS_SOURCE_KIND } from '../lib/install-blueprint.js'
import { FAQ_SOURCE_KIND, syncFaqKnowledge } from '../lib/faq-knowledge.js'
import { documentQuality, textStats } from '@botstudio/shared'
import { SEARCH_MODES, documentChunks, listDocuments, runSearchTest } from '../lib/knowledge-search-test.js'

type JWT = { sub: string; tenantId: string; role: string }

export async function knowledgeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  // ── Intents ─────────────────────────────────────────────────────────────
  app.get('/:botId/intents', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const intents = await prisma.intent.findMany({ where: { botId, tenantId }, orderBy: { name: 'asc' } })
    return { data: intents }
  })

  app.post('/:botId/intents', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ name: z.string().min(1), description: z.string().optional(), utterances: z.array(z.string()).default([]), responses: z.array(z.any()).default([]) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const intent = await prisma.intent.create({ data: { ...body.data, tenantId, botId } })
    return reply.status(201).send({ data: intent })
  })

  app.patch('/:botId/intents/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({ name: z.string().optional(), description: z.string().optional(), utterances: z.array(z.string()).optional(), responses: z.array(z.any()).optional() }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const intent = await prisma.intent.updateMany({ where: { id, botId, tenantId }, data: body.data })
    return { data: intent }
  })

  app.delete('/:botId/intents/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    await prisma.intent.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })

  // ── Entities ─────────────────────────────────────────────────────────────
  app.get('/:botId/entities', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    return { data: await prisma.entity.findMany({ where: { botId, tenantId }, orderBy: { name: 'asc' } }) }
  })

  app.post('/:botId/entities', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ name: z.string().min(1), kind: z.string().default('list'), values: z.array(z.any()).default([]) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    return reply.status(201).send({ data: await prisma.entity.create({ data: { ...body.data, tenantId, botId } }) })
  })

  app.patch('/:botId/entities/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({ name: z.string().optional(), kind: z.string().optional(), values: z.array(z.any()).optional() }).parse(request.body)
    return { data: await prisma.entity.updateMany({ where: { id, botId, tenantId }, data: body }) }
  })

  app.delete('/:botId/entities/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    await prisma.entity.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })

  // ── FAQs ──────────────────────────────────────────────────────────────────
  app.get('/:botId/faqs', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    return { data: await prisma.faq.findMany({ where: { botId, tenantId }, orderBy: { createdAt: 'desc' } }) }
  })

  app.post('/:botId/faqs', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ question: z.string().min(1), answer: z.string().min(1), tags: z.array(z.string()).default([]) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const faq = await prisma.faq.create({ data: { ...body.data, tenantId, botId } })
    await syncFaqKnowledge(tenantId, botId)
    return reply.status(201).send({ data: faq })
  })

  app.patch('/:botId/faqs/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({ question: z.string().optional(), answer: z.string().optional(), tags: z.array(z.string()).optional() }).parse(request.body)
    const updated = await prisma.faq.updateMany({ where: { id, botId, tenantId }, data: body })
    if (updated.count) await syncFaqKnowledge(tenantId, botId)
    return { data: updated }
  })

  app.delete('/:botId/faqs/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const removed = await prisma.faq.deleteMany({ where: { id, botId, tenantId } })
    if (removed.count) await syncFaqKnowledge(tenantId, botId)
    return reply.status(204).send()
  })

  // ── Documents and Search & Test ───────────────────────────────────────────
  app.get('/:botId/knowledge/documents', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const rows = await listDocuments(tenantId, botId)
    return {
      data: rows.map(({ doc, row }) => ({
        ...row,
        quality: documentQuality({ ...row, sourceKind: row.source.kind, ...textStats(doc.content) }),
      })),
    }
  })

  app.get('/:botId/knowledge/documents/:id/chunks', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const found = await documentChunks(tenantId, botId, id)
    if (!found) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } })
    return { data: found }
  })

  app.post('/:botId/knowledge/search-test', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      query: z.string().trim().min(1, 'Type a question to search for.').max(500, 'Keep the question under 500 characters.'),
      mode: z.enum(SEARCH_MODES).default('hybrid'),
      topK: z.number().int().min(1, 'Top K is at least 1.').max(20, 'Top K is at most 20.').default(5),
    }).safeParse(request.body)
    if (!body.success) {
      const issue = body.error.issues[0]
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}` } })
    }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    enterLlmScope({ source: 'retrieval', tenantId, botId })
    return { data: await runSearchTest({ ...body.data, tenantId, botId }) }
  })

  // ── Knowledge Sources ─────────────────────────────────────────────────────
  app.get('/:botId/sources', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    return { data: await prisma.knowledgeSource.findMany({ where: { botId, tenantId }, include: { documents: { select: { id: true, status: true } } }, orderBy: { createdAt: 'desc' } }) }
  })

  app.post('/:botId/sources', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({ name: z.string().min(1), kind: z.enum(['website', 'file', 'url', 'text']), config: z.record(z.any()).default({}) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    return reply.status(201).send({ data: await prisma.knowledgeSource.create({ data: { ...body.data, tenantId, botId } }) })
  })

  // POST /bots/:botId/sources/upload — multipart file upload (PDF / DOCX / TXT)
  app.post('/:botId/sources/upload', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }

    const data = await request.file()
    if (!data) return reply.status(400).send({ error: { code: 'NO_FILE', message: 'No file provided' } })

    const buf = await data.toBuffer()
    const filename = data.filename ?? 'upload'
    const mimetype = data.mimetype ?? 'text/plain'

    let name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')

    let extractedText = ''
    try {
      extractedText = await extractTextFromBuffer(buf, mimetype, filename)
    } catch (err) {
      return reply.status(422).send({ error: { code: 'PARSE_ERROR', message: `Could not extract text: ${err instanceof Error ? err.message : 'Unknown error'}` } })
    }

    if (!extractedText.trim()) {
      return reply.status(422).send({ error: { code: 'EMPTY_FILE', message: 'No text could be extracted from this file' } })
    }

    const source = await prisma.knowledgeSource.create({
      data: {
        tenantId,
        botId,
        name,
        kind: 'file',
        config: { text: extractedText, filename, sizeBytes: buf.length } as never,
      },
    })

    // Enqueue indexing job (chunks + embeddings)
    await enqueueKnowledgeSync({
      tenantId,
      sourceId: source.id,
      botId,
      kind: 'file',
      config: { text: extractedText, filename },
    }).catch(() => {/* queues offline in dev — will be indexed next sync */})

    return reply.status(201).send({ data: source })
  })

  app.delete('/:botId/sources/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const src = await prisma.knowledgeSource.findFirst({ where: { id, botId, tenantId }, select: { kind: true } })
    if (src?.kind === BUSINESS_SOURCE_KIND) {
      return reply.status(409).send({ error: { code: 'MANAGED_SOURCE', message: 'Business details keep this source up to date. To change or remove what it says, edit the fields in Business details.' } })
    }
    if (src?.kind === FAQ_SOURCE_KIND) {
      return reply.status(409).send({ error: { code: 'MANAGED_SOURCE', message: 'The FAQ list keeps this source up to date. To remove a question, delete it in Knowledge > FAQs.' } })
    }
    await prisma.knowledgeSource.deleteMany({ where: { id, botId, tenantId } })
    return reply.status(204).send()
  })

  // POST /bots/:botId/sources/:id/sync  (trigger re-index job)
  app.post('/:botId/sources/:id/sync', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const src = await prisma.knowledgeSource.findFirst({ where: { id, botId, tenantId } })
    if (!src) return reply.status(404).send({ error: { code: 'NOT_FOUND' } })
    if (src.kind === FAQ_SOURCE_KIND) {
      await syncFaqKnowledge(tenantId, botId)
      return { data: { queued: true, sourceId: id } }
    }
    try {
      await enqueueKnowledgeSync({ tenantId, sourceId: id, botId, kind: src.kind as 'website' | 'file', config: src.config as Record<string, unknown> })
    } catch (err) {
      if (err instanceof BackgroundJobsUnavailableError) return reply.status(503).send({ error: { code: err.code, message: err.message } })
      throw err
    }
    await prisma.knowledgeSource.update({ where: { id }, data: { lastSyncAt: new Date() } })
    const url = typeof (src.config as { url?: unknown }).url === 'string' ? (src.config as { url: string }).url : ''
    if (src.kind === 'website' && url) {
      try {
        const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { name: true, personaName: true } })
        const pages = await readPublicSite(url)
        enterLlmScope({ source: 'authoring', tenantId, botId })
        await rereadWebsitePages({
          tenantId,
          botId,
          sourceId: id,
          pages,
          companyName: bot?.name ?? '',
          personaName: bot?.personaName,
        })
      } catch {
        // The catalog reread is best-effort. Indexing still queued.
      }
    }
    return { data: { queued: true, sourceId: id } }
  })

  // GET/PATCH /:botId/inbox-config — inbox operational settings
  app.get('/:botId/inbox-config', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const cfg = await prisma.botConfig.findUnique({ where: { botId } })
    return { data: (cfg?.inboxConfig as object) ?? {} }
  })

  app.patch('/:botId/inbox-config', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.record(z.any()).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION' } })
    const cfg = await prisma.botConfig.upsert({
      where: { botId },
      create: { tenantId, botId, model: DEFAULT_MODELS.anthropic, temperature: 0.3, maxTokens: 2048, systemPrompt: 'You are a helpful assistant.', inboxConfig: body.data },
      update: { inboxConfig: body.data },
    })
    return { data: cfg.inboxConfig }
  })
}
