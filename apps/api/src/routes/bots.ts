import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@ybot/db'
import { normalizedBotName } from '../lib/bot-name.js'
import { deleteBotRecords } from '../lib/delete-bot.js'
import {
  BOT_STARTS,
  START_CLUSTERS,
  bakedPack,
  draftClusteredTemplate,
  draftWebsiteChat,
  identityFor,
  packFromLearned,
  personaAvatar,
  type BotStart,
  type ClusterId,
  type LearnedTemplateSpec,
  type StarterPackId,
} from '@ybot/shared'
import { installCorporatePack, installHairStudioPack, installSitePack, removeStarterPack } from '../lib/install-corporate-pack.js'
import { installDraftWelcome, installStarterFlows } from '../lib/install-starter-flows.js'
import { installWebsiteScan } from '../lib/install-website-scan.js'
import { PublicSiteError, readPublicSite } from '../lib/public-site.js'
import { ensureOptionalChannels, ensureWebChannels } from '../lib/web-channels.js'


interface JwtPayload {
  sub: string
  tenantId: string
  role: string
}

export async function botsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  const canBuild = requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN')

  app.get('/', async (request) => {
    const { tenantId } = request.user as JwtPayload
    const bots = await prisma.bot.findMany({
      where: { tenantId },
      include: { environments: true },
      orderBy: { createdAt: 'asc' },
    })
    return { data: bots }
  })

  app.post('/scan', { preHandler: canBuild }, async (request, reply) => {
    const body = request.body as { url?: string; personaName?: string; companyName?: string }
    try {
      const pages = await readPublicSite(body.url ?? '')
      const draft = draftWebsiteChat({
        pages,
        companyName: body.companyName ?? '',
        personaName: body.personaName,
      })
      return {
        data: {
          url: draft.url,
          pages: draft.pages,
          greeting: draft.greeting,
          doors: draft.doors.map(({ title, flowName, blurb, found }) => ({ title, flowName, blurb, found })),
          facts: draft.facts,
          note: draft.note,
          catalog: draft.catalog,
          chapters: draft.flows.map((flow) => ({ name: flow.name, graph: flow.graph })),
        },
      }
    } catch (err) {
      if (err instanceof PublicSiteError) {
        const status = err.code === 'UNREADABLE' ? 422 : 400
        return reply.status(status).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.get('/start-catalog', async (request) => {
    const { tenantId } = request.user as JwtPayload
    const saved = await prisma.startTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
    const learned = saved.map((item) => {
      const identity = identityFor(item.clusterId)
      return {
        id: 'learned' as const,
        templateId: item.id,
        clusterId: item.clusterId as ClusterId,
        title: item.title,
        body: item.body,
        tag: item.sourceHost ? `From ${item.sourceHost}` : 'From a site',
        persona: identity.persona,
        accent: identity.accent,
        role: identity.role,
        source: item.sourceHost ? { host: item.sourceHost, note: item.body } : undefined,
      }
    })
    return {
      data: {
        clusters: START_CLUSTERS,
        templates: learned,
      },
    }
  })

  app.post('/start-templates/preview', { preHandler: canBuild }, async (request, reply) => {
    const body = request.body as { url?: string; personaName?: string; companyName?: string; clusterId?: ClusterId }
    try {
      const pages = await readPublicSite(body.url ?? '')
      const spec = draftClusteredTemplate({
        pages,
        companyName: body.companyName ?? '',
        personaName: body.personaName,
        clusterId: body.clusterId,
      })
      return { data: spec }
    } catch (err) {
      if (err instanceof PublicSiteError) {
        const status = err.code === 'UNREADABLE' ? 422 : 400
        return reply.status(status).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.post('/start-templates', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const body = request.body as { url?: string; personaName?: string; companyName?: string; clusterId?: ClusterId }
    try {
      const pages = await readPublicSite(body.url ?? '')
      const spec = draftClusteredTemplate({
        pages,
        companyName: body.companyName ?? '',
        personaName: body.personaName,
        clusterId: body.clusterId,
      })
      const saved = await prisma.startTemplate.create({
        data: {
          tenantId,
          clusterId: spec.clusterId,
          title: spec.title,
          body: spec.body,
          sourceUrl: spec.sourceUrl,
          sourceHost: spec.sourceHost,
          spec: spec as unknown as object,
        },
      })
      return reply.status(201).send({ data: { id: saved.id, ...spec } })
    } catch (err) {
      if (err instanceof PublicSiteError) {
        const status = err.code === 'UNREADABLE' ? 422 : 400
        return reply.status(status).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.delete('/start-templates/:id', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const { id } = request.params as { id: string }
    const found = await prisma.startTemplate.findFirst({ where: { id, tenantId } })
    if (!found) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } })
    await prisma.startTemplate.delete({ where: { id } })
    return { data: { id } }
  })

  app.get('/:botId', async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const { botId } = request.params as { botId: string }

    const bot = await prisma.bot.findFirst({
      where: { id: botId, tenantId },
      include: { environments: true },
    })

    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    return { data: bot }
  })

  app.post('/', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const body = request.body as {
      name?: string
      description?: string
      personaName?: string | null
      start?: string
      sample?: string
      websiteUrl?: string
      templateId?: string
      channels?: string[]
    }
    const parsedName = normalizedBotName(body.name ?? '')
    if (!parsedName.ok) {
      return reply.status(400).send({ error: { code: 'INVALID_NAME', message: parsedName.message } })
    }
    const name = parsedName.name
    const start = (body.start ?? 'blank') as BotStart
    if (!(BOT_STARTS as string[]).includes(start)) {
      return reply.status(400).send({ error: { code: 'INVALID_START', message: 'Choose how this bot should start.' } })
    }
    const identity = identityFor(start)
    const personaName = (body.personaName ?? '').trim() || identity.persona || null
    const avatarUrl = personaName ? personaAvatar(personaName, identity.accent) : personaAvatar(name, identity.accent)
    let learnedSpec: LearnedTemplateSpec | null = null
    if (start === 'learned') {
      const templateId = (body.templateId ?? '').trim()
      const saved = templateId
        ? await prisma.startTemplate.findFirst({ where: { id: templateId, tenantId } })
        : null
      if (!saved) {
        return reply.status(400).send({ error: { code: 'INVALID_TEMPLATE', message: 'Choose a saved template from a site.' } })
      }
      learnedSpec = saved.spec as unknown as LearnedTemplateSpec
    }
    let websitePages: Awaited<ReturnType<typeof readPublicSite>> | null = null
    if (start === 'website') {
      const websiteUrl = (body.websiteUrl ?? '').trim()
      if (!websiteUrl) {
        return reply.status(400).send({ error: { code: 'INVALID_URL', message: 'Enter a public website address, like https://yuzu.hair.' } })
      }
      try {
        websitePages = await readPublicSite(websiteUrl)
      } catch (err) {
        if (err instanceof PublicSiteError) {
          const status = err.code === 'UNREADABLE' ? 422 : 400
          return reply.status(status).send({ error: { code: err.code, message: err.message } })
        }
        throw err
      }
    }

    const bot = await prisma.bot.create({
      data: {
        tenantId,
        name,
        description: body.description,
        personaName,
        avatarUrl,
        environments: {
          create: [
            { tenantId, kind: 'sandbox', name: 'Sandbox' },
            { tenantId, kind: 'production', name: 'Production' },
          ],
        },
      },
      include: { environments: true },
    })
    await ensureWebChannels(tenantId, bot.id)
    await ensureOptionalChannels(tenantId, bot.id, Array.isArray(body.channels) ? body.channels : [])

    const sandbox = bot.environments.find((env) => env.kind === 'sandbox')
    const companyName = name
    if (start === 'hair-studio') {
      await installHairStudioPack(tenantId, bot.id, companyName, sandbox?.id ?? null, personaName)
    } else if (start === 'website' && websitePages) {
      const draft = draftWebsiteChat({ pages: websitePages, companyName, personaName })
      await installWebsiteScan(tenantId, bot.id, draft)
    } else if (start === 'corporate') {
      await installCorporatePack(tenantId, bot.id, companyName, sandbox?.id ?? null, personaName)
      await installStarterFlows(tenantId, bot.id, companyName, sandbox?.id ?? null)
    } else if (start === 'product-support' || start === 'crm-platform' || start === 'inbox-assistant') {
      const pack = bakedPack(start, companyName, personaName)
      if (pack) await installSitePack(tenantId, bot.id, companyName, sandbox?.id ?? null, pack)
    } else if (start === 'learned' && learnedSpec) {
      const pack = packFromLearned(learnedSpec, companyName, personaName)
      await installSitePack(tenantId, bot.id, companyName, sandbox?.id ?? null, pack)
    } else if (start === 'sample' || start === 'blank') {
      await installDraftWelcome(tenantId, bot.id, start === 'sample' ? (body.sample ?? '') : '')
    }

    return reply.status(201).send({ data: bot })
  })

  async function importPack(
    request: { user: JwtPayload; params: { botId: string } },
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
    install: (
      tenantId: string,
      botId: string,
      companyName: string,
      environmentId: string | null,
      personaName?: string | null,
    ) => Promise<Awaited<ReturnType<typeof installCorporatePack>>>,
  ) {
    const { tenantId } = request.user
    const { botId } = request.params
    const bot = await prisma.bot.findFirst({
      where: { id: botId, tenantId },
      include: { environments: true },
    })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })

    const sandbox = bot.environments.find((env) => env.kind === 'sandbox') ?? bot.environments[0]
    const result = await install(tenantId, bot.id, bot.name, sandbox?.id ?? null, bot.personaName)
    return {
      data: {
        ...result,
        environmentName: sandbox?.name ?? null,
      },
    }
  }

  app.post('/:botId/packs/corporate-services', { preHandler: canBuild }, async (request, reply) => {
    return importPack(request as { user: JwtPayload; params: { botId: string } }, reply, installCorporatePack)
  })

  app.post('/:botId/packs/hair-studio', { preHandler: canBuild }, async (request, reply) => {
    return importPack(request as { user: JwtPayload; params: { botId: string } }, reply, installHairStudioPack)
  })

  app.delete('/:botId/packs/:packId', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const { botId, packId } = request.params as { botId: string; packId: string }
    const known: StarterPackId[] = ['corporate-services', 'hair-studio', 'product-support', 'crm-platform', 'inbox-assistant']
    if (!known.includes(packId as StarterPackId)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown starter pack' } })
    }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const result = await removeStarterPack(tenantId, bot.id, packId as StarterPackId)
    return { data: result }
  })

  app.patch('/:botId', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const { botId } = request.params as { botId: string }
    const body = request.body as { name?: string; personaName?: string | null; description?: string | null; avatarUrl?: string | null }

    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })

    let name: string | undefined
    if (body.name !== undefined) {
      const parsedName = normalizedBotName(body.name)
      if (!parsedName.ok) {
        return reply.status(400).send({ error: { code: 'INVALID_NAME', message: parsedName.message } })
      }
      name = parsedName.name
    }

    const updated = await prisma.bot.update({
      where: { id: botId },
      data: {
        ...(name !== undefined && { name }),
        ...(body.personaName !== undefined && { personaName: body.personaName ?? null }),
        ...(body.description !== undefined && { description: body.description ?? null }),
        ...(body.avatarUrl !== undefined   && { avatarUrl: body.avatarUrl ?? null }),
      },
      include: { environments: true },
    })
    return { data: updated }
  })

  app.delete('/:botId', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const { botId } = request.params as { botId: string }
    const outcome = await prisma.$transaction((tx) => deleteBotRecords(tx, tenantId, botId))
    if (outcome === 'missing') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    }
    return reply.status(204).send()
  })

  app.patch('/:botId/environments/:environmentId', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const { botId, environmentId } = request.params as { botId: string; environmentId: string }
    const body = request.body as { name?: string }
    const name = (body.name ?? '').trim()
    if (!name || name.length > 40) {
      return reply.status(400).send({ error: { code: 'INVALID_NAME', message: 'Enter a name up to 40 characters.' } })
    }

    const env = await prisma.environment.findFirst({ where: { id: environmentId, botId, tenantId } })
    if (!env) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Environment not found' } })

    const updated = await prisma.environment.update({ where: { id: env.id }, data: { name } })
    return { data: updated }
  })

  app.delete('/:botId/environments/:environmentId', { preHandler: canBuild }, async (request, reply) => {
    const { tenantId } = request.user as JwtPayload
    const { botId, environmentId } = request.params as { botId: string; environmentId: string }

    const env = await prisma.environment.findFirst({ where: { id: environmentId, botId, tenantId } })
    if (!env) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Environment not found' } })

    const remaining = await prisma.environment.count({ where: { botId, tenantId } })
    if (remaining <= 1) {
      return reply.status(409).send({ error: { code: 'LAST_ENVIRONMENT', message: 'A bot needs at least one environment.' } })
    }

    const [channels, conversations, flows] = await Promise.all([
      prisma.channel.count({ where: { environmentId: env.id } }),
      prisma.conversation.count({ where: { environmentId: env.id } }),
      prisma.flowVersion.count({ where: { environmentId: env.id } }),
    ])
    if (channels + conversations + flows > 0) {
      return reply.status(409).send({
        error: { code: 'ENVIRONMENT_IN_USE', message: 'This environment still has a channel, conversation, or published flow.' },
      })
    }

    await prisma.environment.delete({ where: { id: env.id } })
    return reply.status(204).send()
  })
}
