/**
 * Safety: personal data and content guardrails for one bot.
 *
 * GET    /bots/:botId/safety                             privacy settings + guardrail policies
 * PUT    /bots/:botId/safety/privacy                     render modes, custom patterns, reveal-to-agents
 * POST   /bots/:botId/safety/policies                    new policy (active when it is the bot's first)
 * PUT    /bots/:botId/safety/policies/:id                rename / replace rules
 * POST   /bots/:botId/safety/policies/:id/activate       make this the one active policy
 * POST   /bots/:botId/safety/policies/:id/deactivate     no active policy: nothing is checked
 * DELETE /bots/:botId/safety/policies/:id
 * POST   /bots/:botId/safety/test                        Live Test with unsaved settings
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import {
  evaluateGuardrails,
  findPersonalData,
  guardrailIssues,
  parseGuardrailRules,
  parsePrivacySettings,
  privacyIssues,
  PRIVACY_READERS,
  RENDER_MODES,
  type GuardrailRule,
  type PrivacyReader,
} from '@botstudio/shared'
import { requireRole } from '../middleware/auth.js'
import { forgetPrivacy, protectText, renderFor } from '../lib/privacy.js'
import { forgetGuardrails } from '../lib/guardrails.js'

type JWT = { sub: string; tenantId: string; role: string }

const mode = z.enum(RENDER_MODES)
const renderSchema = z.object({ end_user: mode, tool_input: mode, tool_output: mode, logs: mode, human_agent: mode } satisfies Record<PrivacyReader, typeof mode>)

const privacyBody = z.object({
  render: renderSchema,
  revealToAgents: z.boolean(),
  /** Must be true to turn revealToAgents on: the person saw the warning. */
  confirmReveal: z.boolean().optional(),
  custom: z.array(z.object({ name: z.string().trim().max(40), pattern: z.string() })).max(20).default([]),
})

const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().max(80),
  side: z.enum(['input', 'output', 'both']),
  check: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('words'), words: z.array(z.string().trim().max(100)).max(200) }),
    z.object({ kind: z.literal('pattern'), pattern: z.string() }),
    z.object({ kind: z.literal('personal_data'), kinds: z.array(z.string()).max(20) }),
  ]),
  action: z.enum(['warn', 'block', 'redact', 'escalate', 'reask']).default('warn'),
  message: z.string().default(''),
  enabled: z.boolean().default(true),
})

const policyBody = z.object({
  name: z.string().trim().min(1, 'Give the policy a name.').max(80),
  rules: z.array(ruleSchema).max(100).default([]),
})

const testBody = z.object({
  text: z.string().max(5000),
  side: z.enum(['input', 'output']).default('input'),
  privacy: z.unknown().optional(),
  rules: z.array(ruleSchema).max(100).optional(),
})

function presentPolicy(row: { id: string; name: string; active: boolean; rules: unknown; updatedAt: Date }) {
  return { id: row.id, name: row.name, active: row.active, rules: parseGuardrailRules(row.rules), updatedAt: row.updatedAt.toISOString() }
}

function invalid(reply: FastifyReply, code: string, issues: Array<{ field?: string; ruleId?: string; message: string }>) {
  return reply.status(422).send({ error: { code, message: issues[0]?.message ?? 'Check the settings.', issues } })
}

function zodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
}

export async function safetyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  async function ownBot(tenantId: string, botId: string) {
    return prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
  }

  app.get('/:botId/safety', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const [cfg, policies] = await Promise.all([
      prisma.botConfig.findUnique({ where: { botId }, select: { privacy: true } }),
      prisma.guardrailPolicy.findMany({ where: { tenantId, botId }, orderBy: { createdAt: 'asc' } }),
    ])
    return { data: { privacy: parsePrivacySettings(cfg?.privacy), policies: policies.map(presentPolicy) } }
  })

  app.put('/:botId/safety/privacy', { preHandler: requireRole('SUPERVISOR', 'ADMIN') }, async (request, reply) => {
    const { tenantId, role } = request.user as JWT
    const { botId } = request.params as { botId: string }
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const body = privacyBody.safeParse(request.body)
    if (!body.success) return invalid(reply, 'PRIVACY_INVALID', zodIssues(body.error))
    const settings = parsePrivacySettings(body.data)
    const issues = privacyIssues(settings)
    if (issues.length) return invalid(reply, 'PRIVACY_INVALID', issues)
    const current = await prisma.botConfig.findUnique({ where: { botId }, select: { privacy: true } })
    const wasRevealed = parsePrivacySettings(current?.privacy).revealToAgents
    if (settings.revealToAgents && !wasRevealed) {
      if (role !== 'ADMIN') return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only an admin can show personal data to human agents.' } })
      if (!body.data.confirmReveal) {
        return reply.status(422).send({ error: { code: 'CONFIRM_REVEAL', message: 'Confirm the warning to show personal data to human agents.' } })
      }
    }
    await prisma.botConfig.upsert({
      where: { botId },
      create: { tenantId, botId, privacy: settings as object },
      update: { privacy: settings as object },
    })
    forgetPrivacy(botId)
    return { data: settings }
  })

  app.post('/:botId/safety/policies', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const body = policyBody.safeParse(request.body)
    if (!body.success) return invalid(reply, 'POLICY_INVALID', zodIssues(body.error))
    const rules = parseGuardrailRules(body.data.rules)
    const issues = guardrailIssues(rules)
    if (issues.length) return invalid(reply, 'POLICY_INVALID', issues)
    const hasActive = await prisma.guardrailPolicy.count({ where: { botId, active: true } })
    const row = await prisma.guardrailPolicy.create({
      data: { tenantId, botId, name: body.data.name, rules: rules as object[], active: hasActive === 0 },
    })
    forgetGuardrails(botId)
    return reply.status(201).send({ data: presentPolicy(row) })
  })

  app.put('/:botId/safety/policies/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const current = await prisma.guardrailPolicy.findFirst({ where: { id, botId, tenantId } })
    if (!current) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Policy not found' } })
    const body = policyBody.safeParse(request.body)
    if (!body.success) return invalid(reply, 'POLICY_INVALID', zodIssues(body.error))
    const rules: GuardrailRule[] = parseGuardrailRules(body.data.rules)
    const issues = guardrailIssues(rules)
    if (issues.length) return invalid(reply, 'POLICY_INVALID', issues)
    const row = await prisma.guardrailPolicy.update({ where: { id }, data: { name: body.data.name, rules: rules as object[] } })
    forgetGuardrails(botId)
    return { data: presentPolicy(row) }
  })

  app.post('/:botId/safety/policies/:id/activate', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const current = await prisma.guardrailPolicy.findFirst({ where: { id, botId, tenantId } })
    if (!current) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Policy not found' } })
    const issues = guardrailIssues(parseGuardrailRules(current.rules))
    if (issues.length) return invalid(reply, 'POLICY_INVALID', issues)
    await prisma.$transaction([
      prisma.guardrailPolicy.updateMany({ where: { botId, active: true, NOT: { id } }, data: { active: false } }),
      prisma.guardrailPolicy.update({ where: { id }, data: { active: true } }),
    ])
    forgetGuardrails(botId)
    const policies = await prisma.guardrailPolicy.findMany({ where: { tenantId, botId }, orderBy: { createdAt: 'asc' } })
    return { data: policies.map(presentPolicy) }
  })

  app.post('/:botId/safety/policies/:id/deactivate', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const current = await prisma.guardrailPolicy.findFirst({ where: { id, botId, tenantId } })
    if (!current) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Policy not found' } })
    const row = await prisma.guardrailPolicy.update({ where: { id }, data: { active: false } })
    forgetGuardrails(botId)
    return { data: presentPolicy(row) }
  })

  app.delete('/:botId/safety/policies/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const current = await prisma.guardrailPolicy.findFirst({ where: { id, botId, tenantId } })
    if (!current) return reply.status(204).send()
    await prisma.guardrailPolicy.delete({ where: { id } })
    forgetGuardrails(botId)
    return reply.status(204).send()
  })

  app.post('/:botId/safety/test', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const body = testBody.safeParse(request.body)
    if (!body.success) return invalid(reply, 'TEST_INVALID', zodIssues(body.error))
    const [cfg, active] = await Promise.all([
      body.data.privacy === undefined ? prisma.botConfig.findUnique({ where: { botId }, select: { privacy: true } }) : null,
      body.data.rules === undefined ? prisma.guardrailPolicy.findFirst({ where: { botId, active: true } }) : null,
    ])
    const settings = parsePrivacySettings(body.data.privacy ?? cfg?.privacy)
    const rules = parseGuardrailRules(body.data.rules ?? active?.rules ?? [])
    const text = body.data.text
    const found = findPersonalData(text, settings.custom).map(({ kind, start, end }) => ({ kind, start, end }))
    const readers = Object.fromEntries(PRIVACY_READERS.map((reader) => [reader, renderFor(reader, text, settings, tenantId)]))
    const decision = evaluateGuardrails(text, body.data.side, rules, settings.custom)
    return {
      data: {
        found,
        model: protectText(text, settings.custom, tenantId),
        readers,
        guardrails: decision,
      },
    }
  })
}
