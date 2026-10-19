/**
 * Tools registry and Auth Profiles.
 *
 * GET    /bots/:botId/tools                 list
 * POST   /bots/:botId/tools                 create
 * GET    /bots/:botId/tools/:id             one tool
 * PATCH  /bots/:botId/tools/:id             update
 * DELETE /bots/:botId/tools/:id             delete
 * POST   /bots/:botId/tools/:id/test        Testing tab: run once with the given arguments
 * GET    /bots/:botId/tools/:id/runs        recent runs
 * POST   /bots/:botId/tools/mcp/discover    fetch an MCP server's tool definitions
 * POST   /bots/:botId/tools/mcp/import      add chosen MCP tools to the registry
 * POST   /bots/:botId/tools/:id/refresh     re-fetch one MCP tool's definition
 *
 * GET/POST/PATCH/DELETE /auth-profiles      credentials, sealed at rest, never returned
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@ybot/db'
import { z } from 'zod'
import {
  AUTH_PROFILE_KINDS, TOOL_EFFECTS, TOOL_KINDS, TOOL_PARAM_TYPES,
  defaultToolConfig, parametersFromJsonSchema, toolIssues, type ToolDraft, type ToolParameter,
} from '@ybot/shared'
import { requireRole } from '../middleware/auth.js'
import { findTool, presentTool, runAndRecord } from '../lib/tools-store.js'
import { applyAuthProfile, publicAuthProfile } from '../lib/auth-profiles.js'
import { sealSecret, secretHint } from '../lib/secrets.js'
import { assertPublicUrl } from '../lib/public-url.js'
import { mcpListTools } from '../lib/mcp-client.js'

type JWT = { sub: string; tenantId: string; role: string }

const parameterSchema = z.object({
  name: z.string(),
  type: z.enum(TOOL_PARAM_TYPES),
  description: z.string().default(''),
  required: z.boolean().default(false),
  enum: z.array(z.string()).optional(),
})

const toolBody = z.object({
  name: z.string().trim(),
  kind: z.enum(TOOL_KINDS),
  description: z.string().default(''),
  parameters: z.array(parameterSchema).default([]),
  returns: z.object({ type: z.enum(TOOL_PARAM_TYPES), description: z.string().default('') }).default({ type: 'object', description: '' }),
  effect: z.enum(TOOL_EFFECTS).default('read'),
  config: z.record(z.unknown()).optional(),
  authProfileId: z.string().nullable().optional(),
})

function invalid(reply: FastifyReply, issues: Array<{ field: string; message: string }>) {
  return reply.status(422).send({ error: { code: 'TOOL_INVALID', message: issues[0]?.message ?? 'Check the tool.', issues } })
}

async function profileBelongs(tenantId: string, authProfileId: string | null | undefined): Promise<boolean> {
  if (!authProfileId) return true
  return Boolean(await prisma.authProfile.findFirst({ where: { id: authProfileId, tenantId }, select: { id: true } }))
}

async function profileFor(tenantId: string, authProfileId: string | null | undefined) {
  if (!authProfileId) return null
  return prisma.authProfile.findFirst({ where: { id: authProfileId, tenantId } })
}

export async function toolsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/:botId/tools', async (request) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const tools = await prisma.tool.findMany({
      where: { tenantId, botId },
      include: { authProfile: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    })
    const lastRuns = tools.length
      ? await prisma.toolRun.findMany({
          where: { toolId: { in: tools.map((tool) => tool.id) } },
          orderBy: { createdAt: 'desc' },
          distinct: ['toolId'],
          select: { toolId: true, ok: true, createdAt: true, durationMs: true },
        })
      : []
    const lastByTool = new Map(lastRuns.map((run) => [run.toolId, run]))
    return {
      data: tools.map((tool) => {
        const last = lastByTool.get(tool.id)
        return { ...presentTool(tool), lastRun: last ? { ok: last.ok, at: last.createdAt.toISOString(), durationMs: last.durationMs } : null }
      }),
    }
  })

  app.post('/:botId/tools', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const parsed = toolBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: parsed.error.flatten() } })
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    const draft: ToolDraft = { ...parsed.data, config: parsed.data.config ?? defaultToolConfig(parsed.data.kind) }
    const issues = toolIssues(draft)
    if (issues.length) return invalid(reply, issues)
    if (!(await profileBelongs(tenantId, draft.authProfileId))) return invalid(reply, [{ field: 'authProfileId', message: 'Auth Profile: choose a profile from this workspace.' }])
    if (await prisma.tool.findFirst({ where: { botId, name: draft.name }, select: { id: true } })) {
      return invalid(reply, [{ field: 'name', message: `Name: this bot already has a tool called ${draft.name}.` }])
    }
    const tool = await prisma.tool.create({
      data: {
        tenantId, botId, name: draft.name, kind: draft.kind, description: draft.description.trim(),
        parameters: draft.parameters as object[], returns: draft.returns as object, effect: draft.effect,
        config: draft.config as object, authProfileId: draft.authProfileId ?? null,
      },
      include: { authProfile: { select: { id: true, name: true } } },
    })
    const after = presentTool(tool)
    return reply.status(201).send({ data: after })
  })

  app.get('/:botId/tools/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const tool = await findTool(tenantId, botId, id)
    if (!tool) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This tool is no longer in the Tools list.' } })
    return { data: presentTool(tool) }
  })

  app.patch('/:botId/tools/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const parsed = toolBody.partial().safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: parsed.error.flatten() } })
    const current = await findTool(tenantId, botId, id)
    if (!current) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This tool is no longer in the Tools list.' } })
    const draft: ToolDraft = {
      name: parsed.data.name ?? current.name,
      kind: parsed.data.kind ?? (current.kind as ToolDraft['kind']),
      description: parsed.data.description ?? current.description,
      parameters: parsed.data.parameters ?? (current.parameters as unknown as ToolParameter[]),
      returns: parsed.data.returns ?? (current.returns as unknown as ToolDraft['returns']),
      effect: parsed.data.effect ?? (current.effect as ToolDraft['effect']),
      config: parsed.data.config ?? (current.config as Record<string, unknown>),
      authProfileId: parsed.data.authProfileId === undefined ? current.authProfileId : parsed.data.authProfileId,
    }
    const issues = toolIssues(draft)
    if (issues.length) return invalid(reply, issues)
    if (!(await profileBelongs(tenantId, draft.authProfileId))) return invalid(reply, [{ field: 'authProfileId', message: 'Auth Profile: choose a profile from this workspace.' }])
    if (draft.name !== current.name && await prisma.tool.findFirst({ where: { botId, name: draft.name }, select: { id: true } })) {
      return invalid(reply, [{ field: 'name', message: `Name: this bot already has a tool called ${draft.name}.` }])
    }
    const tool = await prisma.tool.update({
      where: { id: current.id },
      data: {
        name: draft.name, kind: draft.kind, description: draft.description.trim(), parameters: draft.parameters as object[],
        returns: draft.returns as object, effect: draft.effect, config: draft.config as object, authProfileId: draft.authProfileId ?? null,
      },
      include: { authProfile: { select: { id: true, name: true } } },
    })
    const after = presentTool(tool)
    return { data: after }
  })

  app.delete('/:botId/tools/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const current = await findTool(tenantId, botId, id)
    if (!current) return reply.status(204).send()
    await prisma.tool.delete({ where: { id: current.id } })
    return reply.status(204).send()
  })

  app.post('/:botId/tools/:id/test', async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const body = z.object({ args: z.record(z.unknown()).default({}) }).safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Arguments must be a JSON object.' } })
    const tool = await findTool(tenantId, botId, id)
    if (!tool) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This tool is no longer in the Tools list.' } })
    const result = await runAndRecord(tool, body.data.args, { source: 'console', actorId: sub })
    return { data: result }
  })

  app.get('/:botId/tools/:id/runs', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const tool = await prisma.tool.findFirst({ where: { id, tenantId, botId }, select: { id: true } })
    if (!tool) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This tool is no longer in the Tools list.' } })
    const runs = await prisma.toolRun.findMany({ where: { toolId: id }, orderBy: { createdAt: 'desc' }, take: 25 })
    return { data: runs.map((run) => ({ ...run, createdAt: run.createdAt.toISOString() })) }
  })

  const mcpSource = z.object({ serverUrl: z.string().url(), authProfileId: z.string().nullable().optional() })

  async function discover(tenantId: string, serverUrl: string, authProfileId?: string | null) {
    const profile = await profileFor(tenantId, authProfileId)
    if (authProfileId && !profile) throw new Error('Auth Profile: choose a profile from this workspace.')
    const auth = applyAuthProfile(profile)
    const url = new URL(serverUrl)
    for (const [key, value] of Object.entries(auth.query)) url.searchParams.set(key, value)
    return mcpListTools(url.toString(), { fetch: globalThis.fetch, checkUrl: (u) => assertPublicUrl(u), headers: auth.headers, timeoutMs: 20_000 })
  }

  app.post('/:botId/tools/mcp/discover', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const body = mcpSource.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'MCP server: enter the server URL, starting with https://.' } })
    try {
      const tools = await discover(tenantId, body.data.serverUrl, body.data.authProfileId)
      return { data: { fetchedAt: new Date().toISOString(), tools: tools.map((tool) => ({ ...tool, parameters: parametersFromJsonSchema(tool.inputSchema) })) } }
    } catch (err) {
      return reply.status(502).send({ error: { code: 'MCP_FETCH', message: err instanceof Error ? err.message : 'The MCP server could not be reached.' } })
    }
  })

  app.post('/:botId/tools/mcp/import', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    const body = mcpSource.extend({ toolNames: z.array(z.string()).min(1), effect: z.enum(TOOL_EFFECTS).default('read') }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Pick at least one MCP tool to add.' } })
    const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
    if (!bot) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    let remote
    try {
      remote = await discover(tenantId, body.data.serverUrl, body.data.authProfileId)
    } catch (err) {
      return reply.status(502).send({ error: { code: 'MCP_FETCH', message: err instanceof Error ? err.message : 'The MCP server could not be reached.' } })
    }
    const fetchedAt = new Date().toISOString()
    const created = []
    const skipped: string[] = []
    for (const name of body.data.toolNames) {
      const found = remote.find((tool) => tool.name === name)
      if (!found) { skipped.push(`${name}: the server no longer offers it.`); continue }
      const localName = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 64) || 'mcp_tool'
      if (await prisma.tool.findFirst({ where: { botId, name: localName }, select: { id: true } })) { skipped.push(`${name}: this bot already has a tool called ${localName}.`); continue }
      const draft: ToolDraft = {
        name: localName,
        kind: 'mcp',
        description: found.description.trim().length >= 20 ? found.description.trim() : `${found.description.trim() || name} (from the MCP server; describe when the bot should use it).`,
        parameters: parametersFromJsonSchema(found.inputSchema).map((param) => ({ ...param, description: param.description || param.name })),
        returns: { type: 'object', description: 'What the MCP tool returns.' },
        effect: body.data.effect,
        config: { serverUrl: body.data.serverUrl, toolName: name, inputSchema: found.inputSchema, fetchedAt },
        authProfileId: body.data.authProfileId ?? null,
      }
      const issues = toolIssues(draft)
      if (issues.length) { skipped.push(`${name}: ${issues[0]!.message}`); continue }
      const tool = await prisma.tool.create({
        data: {
          tenantId, botId, name: draft.name, kind: 'mcp', description: draft.description, parameters: draft.parameters as object[],
          returns: draft.returns as object, effect: draft.effect, config: draft.config as object, authProfileId: draft.authProfileId ?? null,
        },
        include: { authProfile: { select: { id: true, name: true } } },
      })
      const after = presentTool(tool)
      created.push(after)
    }
    return reply.status(201).send({ data: { created, skipped } })
  })

  app.post('/:botId/tools/:id/refresh', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const current = await findTool(tenantId, botId, id)
    if (!current) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This tool is no longer in the Tools list.' } })
    if (current.kind !== 'mcp') return reply.status(409).send({ error: { code: 'NOT_MCP', message: 'Only MCP tools are fetched from a server.' } })
    const config = current.config as Record<string, unknown>
    let remote
    try {
      remote = await discover(tenantId, String(config['serverUrl'] ?? ''), current.authProfileId)
    } catch (err) {
      return reply.status(502).send({ error: { code: 'MCP_FETCH', message: err instanceof Error ? err.message : 'The MCP server could not be reached.' } })
    }
    const found = remote.find((tool) => tool.name === config['toolName'])
    if (!found) return reply.status(409).send({ error: { code: 'MCP_GONE', message: `The server no longer offers ${String(config['toolName'])}. Delete this tool or pick another.` } })
    const known = new Map((current.parameters as unknown as ToolParameter[]).map((param) => [param.name, param]))
    const parameters = parametersFromJsonSchema(found.inputSchema).map((param) => ({ ...param, description: param.description || known.get(param.name)?.description || param.name }))
    const tool = await prisma.tool.update({
      where: { id: current.id },
      data: { parameters: parameters as object[], config: { ...config, inputSchema: found.inputSchema, fetchedAt: new Date().toISOString() } as object },
      include: { authProfile: { select: { id: true, name: true } } },
    })
    const after = presentTool(tool)
    return { data: after }
  })
}

const profileBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(AUTH_PROFILE_KINDS),
  settings: z.object({
    headerName: z.string().trim().max(100).optional(),
    queryParam: z.string().trim().max(100).optional(),
    username: z.string().max(200).optional(),
    prefix: z.string().max(40).optional(),
  }).default({}),
  secret: z.string().min(1).max(8_000).optional(),
})

function profileIssues(kind: string, settings: { headerName?: string; queryParam?: string; username?: string }): string | undefined {
  if (kind === 'custom_header' && !settings.headerName) return 'Header name: enter the header the service expects, for example X-Api-Token.'
  if (kind === 'basic' && !settings.username) return 'Username: enter the username that goes with the password.'
  if (settings.headerName && !/^[A-Za-z0-9-]+$/.test(settings.headerName)) return 'Header name: use letters, digits and dashes only.'
  return undefined
}

export async function authProfilesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  app.get('/', async (request) => {
    const { tenantId } = request.user as JWT
    const rows = await prisma.authProfile.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, include: { _count: { select: { tools: true } } } })
    return { data: rows.map((row) => ({ ...publicAuthProfile(row), toolCount: row._count.tools })) }
  })

  app.post('/', async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const body = profileBody.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const problem = profileIssues(body.data.kind, body.data.settings)
    if (problem) return reply.status(422).send({ error: { code: 'PROFILE_INVALID', message: problem } })
    if (!body.data.secret) return reply.status(422).send({ error: { code: 'PROFILE_INVALID', message: 'Secret: paste the key, token or password.' } })
    if (await prisma.authProfile.findFirst({ where: { tenantId, name: body.data.name }, select: { id: true } })) {
      return reply.status(422).send({ error: { code: 'PROFILE_INVALID', message: `Name: an Auth Profile called ${body.data.name} already exists.` } })
    }
    const row = await prisma.authProfile.create({
      data: {
        tenantId, name: body.data.name, kind: body.data.kind, settings: body.data.settings,
        secretEnc: sealSecret(body.data.secret), secretHint: secretHint(body.data.secret), createdBy: sub,
      },
    })
    const after = publicAuthProfile(row)
    return reply.status(201).send({ data: after })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const body = profileBody.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', details: body.error.flatten() } })
    const current = await prisma.authProfile.findFirst({ where: { id, tenantId } })
    if (!current) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'This Auth Profile no longer exists.' } })
    const kind = body.data.kind ?? current.kind
    const settings = body.data.settings ?? (current.settings as Record<string, string>)
    const problem = profileIssues(kind, settings)
    if (problem) return reply.status(422).send({ error: { code: 'PROFILE_INVALID', message: problem } })
    if (body.data.name && body.data.name !== current.name && await prisma.authProfile.findFirst({ where: { tenantId, name: body.data.name }, select: { id: true } })) {
      return reply.status(422).send({ error: { code: 'PROFILE_INVALID', message: `Name: an Auth Profile called ${body.data.name} already exists.` } })
    }
    const row = await prisma.authProfile.update({
      where: { id: current.id },
      data: {
        name: body.data.name ?? current.name,
        kind,
        settings,
        ...(body.data.secret ? { secretEnc: sealSecret(body.data.secret), secretHint: secretHint(body.data.secret) } : {}),
      },
    })
    const after = publicAuthProfile(row)
    return { data: after }
  })

  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { id } = request.params as { id: string }
    const current = await prisma.authProfile.findFirst({ where: { id, tenantId }, include: { _count: { select: { tools: true } } } })
    if (!current) return reply.status(204).send()
    if (current._count.tools > 0) {
      return reply.status(409).send({ error: { code: 'PROFILE_IN_USE', message: `${current._count.tools} tool${current._count.tools === 1 ? ' uses' : 's use'} this profile. Choose another profile on ${current._count.tools === 1 ? 'that tool' : 'those tools'} first.` } })
    }
    await prisma.authProfile.delete({ where: { id: current.id } })
    return reply.status(204).send()
  })
}
