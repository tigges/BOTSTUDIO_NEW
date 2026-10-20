/**
 * Export and import a bot as one readable file.
 *
 * GET  /api/v1/bots/:botId/bundle?format=json|yaml   download
 * POST /api/v1/bots/:botId/bundle/import             { content, mode, dryRun }
 *   dryRun true (default): the plan, item by item, and nothing changes.
 *   dryRun false: the same plan is applied. Chapters land as drafts.
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '@ybot/db'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { applyImport, buildBundle, BundleError, IMPORT_MODES, parseBundle, planForBot, serialiseBundle } from '../lib/bundle.js'
import { forgetGuardrails } from '../lib/guardrails.js'
import { forgetPrivacy } from '../lib/privacy.js'

type JWT = { sub: string; tenantId: string; role: string }

const MAX_BUNDLE_BYTES = 2 * 1024 * 1024

function fileName(botName: string, format: string): string {
  const slug = botName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot'
  return `${slug}.botstudio.${format === 'yaml' ? 'yaml' : 'json'}`
}

export async function bundleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/bundle', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const { format } = request.query as { format?: string }
    const kind = format === 'yaml' ? 'yaml' : 'json'
    try {
      const bundle = await buildBundle(botId, tenantId)
      return reply
        .header('Content-Type', kind === 'yaml' ? 'application/yaml; charset=utf-8' : 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${fileName(bundle.bot.name, kind)}"`)
        .send(serialiseBundle(bundle, kind))
    } catch (err) {
      if (err instanceof BundleError) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } })
      throw err
    }
  })

  app.post('/:botId/bundle/import', { bodyLimit: MAX_BUNDLE_BYTES + 64 * 1024 }, async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = z.object({
      content: z.string().min(1, 'Choose a file to import.').max(MAX_BUNDLE_BYTES, 'The file is larger than 2 MB.'),
      mode: z.enum(IMPORT_MODES as [string, ...string[]]).default('merge'),
      dryRun: z.boolean().default(true),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: body.error.issues[0]?.message ?? 'Choose a file to import.' } })
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    try {
      const bundle = parseBundle(body.data.content)
      const mode = body.data.mode as 'skip' | 'merge' | 'replace'
      const plan = await planForBot(botId, tenantId, bundle, mode)
      if (!body.data.dryRun) {
        await applyImport(botId, tenantId, bundle, plan)
        forgetGuardrails(botId)
        forgetPrivacy(botId)
      }
      return { data: { applied: !body.data.dryRun, from: bundle.bot.name, ...plan } }
    } catch (err) {
      if (err instanceof BundleError) return reply.status(422).send({ error: { code: 'BUNDLE_INVALID', message: err.message, issues: err.issues } })
      throw err
    }
  })
}
