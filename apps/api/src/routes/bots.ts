import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware/auth.js'
import { prisma } from '@ybot/db'
import { normalizedBotName } from '../lib/bot-name.js'
import { deleteBotRecords } from '../lib/delete-bot.js'
import { draftWebsiteChat } from '@ybot/shared'
import { installCorporatePack, installHairStudioPack, removeStarterPack } from '../lib/install-corporate-pack.js'
import { installDraftWelcome, installStarterFlows } from '../lib/install-starter-flows.js'
import { installWebsiteScan } from '../lib/install-website-scan.js'
import { PublicSiteError, readPublicSite } from '../lib/public-site.js'

const BOT_STARTS = ['hair-studio', 'corporate', 'sample', 'blank', 'website'] as const
type BotStart = (typeof BOT_STARTS)[number]


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
    }
    const parsedName = normalizedBotName(body.name ?? '')
    if (!parsedName.ok) {
      return reply.status(400).send({ error: { code: 'INVALID_NAME', message: parsedName.message } })
    }
    const name = parsedName.name
    const start = (body.start ?? 'blank') as BotStart
    if (!BOT_STARTS.includes(start)) {
      return reply.status(400).send({ error: { code: 'INVALID_START', message: 'Choose how this bot should start.' } })
    }
    const personaName = (body.personaName ?? '').trim() || null
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
        environments: {
          create: [
            { tenantId, kind: 'sandbox', name: 'Sandbox' },
            { tenantId, kind: 'production', name: 'Production' },
          ],
        },
      },
      include: { environments: true },
    })

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    const sandbox = bot.environments.find((env) => env.kind === 'sandbox')
    const companyName = tenant?.name ?? name
    if (start === 'hair-studio') {
      await installHairStudioPack(tenantId, bot.id, companyName, sandbox?.id ?? null, personaName)
    } else if (start === 'website' && websitePages) {
      const draft = draftWebsiteChat({ pages: websitePages, companyName: name, personaName })
      await installWebsiteScan(tenantId, bot.id, draft)
    } else if (start === 'corporate') {
      await installCorporatePack(tenantId, bot.id, companyName, sandbox?.id ?? null)
      await installStarterFlows(tenantId, bot.id, companyName, sandbox?.id ?? null)
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

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    const sandbox = bot.environments.find((env) => env.kind === 'sandbox') ?? bot.environments[0]
    const result = await install(tenantId, bot.id, tenant?.name ?? bot.name, sandbox?.id ?? null, bot.personaName)
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
    if (packId !== 'corporate-services' && packId !== 'hair-studio') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown starter pack' } })
    }
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const result = await removeStarterPack(tenantId, bot.id, packId)
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
