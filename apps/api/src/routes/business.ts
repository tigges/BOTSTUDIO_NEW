/**
 * Blueprints and business details.
 *
 * GET  /bots/blueprints                    what the wizard lists
 * GET  /bots/blueprints/:id/sample         the blueprint's example business (Harbour Dental)
 * POST /bots/blueprints/:id/scan           read a public website into business details, for review
 * GET  /bots/:botId/business               the bot's business details, with what still needs a look
 * PUT  /bots/:botId/business               save edits; the catalog, Knowledge and evals follow at once
 * POST /bots/:botId/business/reread        read the website again and list what would change
 * POST /bots/:botId/business/accept        take the changes a person ticked
 *
 * Reading a website here is rule-based: no model call, no cost.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@ybot/db'
import { z } from 'zod'
import {
  acceptChanges,
  applyProfileEdit,
  blueprintById,
  blueprintCards,
  diffProfiles,
  parseBusinessProfile,
  profileIssues,
  type Blueprint,
  type BusinessProfile,
} from '@ybot/shared'
import { requireRole } from '../middleware/auth.js'
import { PublicSiteError, readPublicSite } from '../lib/public-site.js'
import { BUSINESS_SOURCE_KIND, saveBusinessProfile } from '../lib/install-blueprint.js'

type JWT = { sub: string; tenantId: string; role: string }

const scanBody = z.object({
  url: z.string().trim().min(1).max(400),
  businessName: z.string().trim().max(120).optional(),
  personaName: z.string().trim().max(60).optional(),
})
const saveBody = z.object({ profile: z.unknown() })
const rereadBody = z.object({ url: z.string().trim().max(400).optional() })
const acceptBody = z.object({ fresh: z.unknown(), keys: z.array(z.string().max(64)).max(50) })

function siteError(reply: FastifyReply, err: unknown) {
  if (err instanceof PublicSiteError) {
    return reply.status(err.code === 'UNREADABLE' ? 422 : 400).send({ error: { code: err.code, message: err.message } })
  }
  throw err
}

/** Reads a site with one blueprint. The name a person typed beats the page title. */
export async function readBusinessFromSite(blueprint: Blueprint, input: { url: string; businessName?: string; personaName?: string }): Promise<BusinessProfile> {
  const pages = await readPublicSite(input.url)
  const profile = blueprint.extract(pages, new Date().toISOString())
  return {
    ...profile,
    businessName: input.businessName?.trim() || profile.businessName,
    ...(input.personaName?.trim() ? { personaName: input.personaName.trim() } : {}),
  }
}

async function whoIs(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } }).catch(() => null)
  return user?.displayName || user?.email || userId
}

async function loadBusiness(tenantId: string, botId: string) {
  const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true, name: true, personaName: true, config: { select: { business: true } } } })
  if (!bot) return null
  const raw = bot.config?.business as { blueprintId?: string } | undefined
  const blueprint = blueprintById(raw?.blueprintId)
  const profile = blueprint ? parseBusinessProfile(blueprint.fields, raw) : null
  return { bot, blueprint, profile }
}

function card(blueprint: Blueprint) {
  return blueprintCards().find((item) => item.id === blueprint.id)!
}

export async function businessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  const canBuild = requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN')

  app.get('/blueprints', async () => ({ data: blueprintCards() }))

  app.get('/blueprints/:id/sample', async (request, reply) => {
    const blueprint = blueprintById((request.params as { id: string }).id)
    if (!blueprint) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This blueprint is no longer offered.' } })
    const profile = blueprint.sample()
    return { data: { profile, issues: profileIssues(blueprint.fields, profile) } }
  })

  app.post('/blueprints/:id/scan', { preHandler: canBuild }, async (request, reply) => {
    const blueprint = blueprintById((request.params as { id: string }).id)
    if (!blueprint) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This blueprint is no longer offered.' } })
    const body = scanBody.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'INVALID_URL', message: 'Website: enter a public address, like https://www.example-dental.co.uk.' } })
    try {
      const profile = await readBusinessFromSite(blueprint, body.data)
      return { data: { profile, issues: profileIssues(blueprint.fields, profile) } }
    } catch (err) {
      return siteError(reply, err)
    }
  })

  app.get('/:botId/business', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const found = await loadBusiness(tenantId, (request.params as { botId: string }).botId)
    if (!found) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    if (!found.blueprint || !found.profile) return { data: { blueprint: null, profile: null, issues: [], documents: 0 } }
    const documents = await prisma.document.count({ where: { tenantId, knowledgeSource: { botId: found.bot.id, kind: BUSINESS_SOURCE_KIND } } })
    return {
      data: {
        blueprint: card(found.blueprint),
        profile: found.profile,
        issues: profileIssues(found.blueprint.fields, found.profile),
        documents,
      },
    }
  })

  app.put('/:botId/business', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const botId = (request.params as { botId: string }).botId
    const found = await loadBusiness(tenantId, botId)
    if (!found) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    if (!found.blueprint || !found.profile) {
      return reply.status(409).send({ error: { code: 'NO_BLUEPRINT', message: 'This bot was not started from a blueprint, so it has no business details to edit.' } })
    }
    const body = saveBody.safeParse(request.body)
    const next = body.success ? parseBusinessProfile(found.blueprint.fields, { ...(body.data.profile as object), blueprintId: found.blueprint.id }) : null
    if (!next) return reply.status(400).send({ error: { code: 'INVALID_PROFILE', message: 'Business details: send every field as it appears on the form.' } })
    const issues = profileIssues(found.blueprint.fields, next)
    const blocking = issues.filter((issue) => issue.level === 'block')
    if (blocking.length) return reply.status(422).send({ error: { code: 'PROFILE_INVALID', message: blocking[0]!.message, issues } })
    const profile = applyProfileEdit(found.blueprint.fields, found.profile, next, { userId: await whoIs(sub), at: new Date().toISOString() })
    const saved = await saveBusinessProfile(tenantId, botId, found.blueprint, profile)
    return { data: { profile, issues: profileIssues(found.blueprint.fields, profile), ...saved } }
  })

  app.post('/:botId/business/reread', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JWT
    const found = await loadBusiness(tenantId, (request.params as { botId: string }).botId)
    if (!found) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    if (!found.blueprint || !found.profile) {
      return reply.status(409).send({ error: { code: 'NO_BLUEPRINT', message: 'This bot was not started from a blueprint, so there is nothing to compare.' } })
    }
    const body = rereadBody.safeParse(request.body ?? {})
    const url = (body.success ? body.data.url : '') || found.profile.websiteUrl || ''
    if (!url) return reply.status(400).send({ error: { code: 'INVALID_URL', message: 'Website: this bot started from the sample business. Enter the address to read.' } })
    try {
      const fresh = await readBusinessFromSite(found.blueprint, { url, businessName: found.profile.businessName })
      return { data: { changes: diffProfiles(found.blueprint.fields, found.profile, fresh), fresh } }
    } catch (err) {
      return siteError(reply, err)
    }
  })

  app.post('/:botId/business/accept', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const botId = (request.params as { botId: string }).botId
    const found = await loadBusiness(tenantId, botId)
    if (!found) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    if (!found.blueprint || !found.profile) {
      return reply.status(409).send({ error: { code: 'NO_BLUEPRINT', message: 'This bot was not started from a blueprint, so it has no business details to update.' } })
    }
    const body = acceptBody.safeParse(request.body)
    const fresh = body.success ? parseBusinessProfile(found.blueprint.fields, { ...(body.data.fresh as object), blueprintId: found.blueprint.id }) : null
    if (!body.success || !fresh) return reply.status(400).send({ error: { code: 'INVALID_CHANGES', message: 'Tick the changes to keep, then try again.' } })
    const keys = body.data.keys.filter((key) => found.blueprint!.fields.some((spec) => spec.key === key))
    const profile = acceptChanges(found.profile, fresh, keys, { userId: await whoIs(sub), at: new Date().toISOString() })
    const saved = await saveBusinessProfile(tenantId, botId, found.blueprint, profile)
    return { data: { profile, accepted: keys, issues: profileIssues(found.blueprint.fields, profile), ...saved } }
  })
}
