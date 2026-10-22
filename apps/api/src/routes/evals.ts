/**
 * Eval suites and their runs.
 *
 * GET    /api/v1/bots/:botId/evals                 suites with their latest run
 * POST   /api/v1/bots/:botId/evals                 { name, gate?, scenarios? }
 * PUT    /api/v1/bots/:botId/evals/:id             { name, gate, scenarios }
 * DELETE /api/v1/bots/:botId/evals/:id
 * POST   /api/v1/bots/:botId/evals/:id/run         runs the suite on the working copy
 * GET    /api/v1/bots/:botId/evals/:id/runs        newest runs first
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@botstudio/db'
import { z } from 'zod'
import { EVAL_ENDINGS, EVAL_LIMITS, evalIssues, parseEvalScenarios, type EvalScenarioResult } from '@botstudio/shared'
import { requireRole } from '../middleware/auth.js'
import { runSuite } from '../lib/evals.js'
import { hasSteps, workingCopy } from '../lib/releases.js'

type JWT = { sub: string; tenantId: string; role: string }

const checkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('says'), text: z.string().max(EVAL_LIMITS.text) }),
  z.object({ kind: z.literal('never_says'), text: z.string().max(EVAL_LIMITS.text) }),
  z.object({ kind: z.literal('ends'), ending: z.enum(EVAL_ENDINGS) }),
  z.object({ kind: z.literal('reaches_chapter'), chapter: z.string().max(120) }),
  z.object({ kind: z.literal('not_blocked') }),
])

const scenarioSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().max(120),
  turns: z.array(z.string().max(EVAL_LIMITS.text)).max(EVAL_LIMITS.turns + 1),
  checks: z.array(checkSchema).max(EVAL_LIMITS.checks + 1),
})

const suiteBody = z.object({
  name: z.string().trim().min(1, 'Give the suite a name.').max(80),
  gate: z.boolean().default(true),
  scenarios: z.array(scenarioSchema).max(EVAL_LIMITS.scenarios + 1).default([]),
})
type RunRow = {
  id: string
  suiteId: string
  trigger: string
  status: string
  passed: number
  failed: number
  costUsd: number | null
  durationMs: number
  results: unknown
  target: unknown
  createdAt: Date
}

export function presentRun(row: RunRow, withResults = true) {
  return {
    id: row.id,
    suiteId: row.suiteId,
    trigger: row.trigger,
    status: row.status,
    passed: row.passed,
    failed: row.failed,
    costUsd: row.costUsd,
    durationMs: row.durationMs,
    target: row.target,
    createdAt: row.createdAt.toISOString(),
    ...(withResults ? { results: (Array.isArray(row.results) ? row.results : []) as EvalScenarioResult[] } : {}),
  }
}

function invalid(reply: FastifyReply, issues: Array<{ scenarioId?: string; field?: string; message: string }>) {
  return reply.status(422).send({ error: { code: 'EVAL_INVALID', message: issues[0]?.message ?? 'Check the suite.', issues } })
}

export async function evalsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireRole('DEVELOPER', 'SUPERVISOR', 'ADMIN'))

  async function ownBot(tenantId: string, botId: string) {
    return prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { id: true } })
  }

  async function ownSuite(tenantId: string, botId: string, id: string) {
    return prisma.evalSuite.findFirst({ where: { id, botId, tenantId } })
  }

  app.get('/:botId/evals', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const suites = await prisma.evalSuite.findMany({
      where: { botId, tenantId },
      orderBy: { createdAt: 'asc' },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    const flows = await prisma.flow.findMany({ where: { botId, tenantId }, select: { name: true }, orderBy: { name: 'asc' } })
    return {
      data: {
        suites: suites.map((suite) => ({
          id: suite.id,
          name: suite.name,
          gate: suite.gate,
          scenarios: parseEvalScenarios(suite.scenarios),
          updatedAt: suite.updatedAt.toISOString(),
          latestRun: suite.runs[0] ? presentRun(suite.runs[0]) : null,
        })),
        chapters: flows.map((flow) => flow.name),
      },
    }
  })

  app.post('/:botId/evals', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId } = request.params as { botId: string }
    if (!await ownBot(tenantId, botId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    const body = suiteBody.safeParse(request.body)
    if (!body.success) return invalid(reply, body.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })))
    const scenarios = parseEvalScenarios(body.data.scenarios)
    const issues = evalIssues(scenarios)
    if (issues.length) return invalid(reply, issues)
    const row = await prisma.evalSuite.create({
      data: { tenantId, botId, name: body.data.name, gate: body.data.gate, scenarios: scenarios as unknown as object },
    })
    return reply.status(201).send({ data: { id: row.id, name: row.name, gate: row.gate, scenarios, updatedAt: row.updatedAt.toISOString(), latestRun: null } })
  })

  app.put('/:botId/evals/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    if (!await ownSuite(tenantId, botId, id)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Suite not found' } })
    const body = suiteBody.safeParse(request.body)
    if (!body.success) return invalid(reply, body.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })))
    const scenarios = parseEvalScenarios(body.data.scenarios)
    const issues = evalIssues(scenarios)
    if (issues.length) return invalid(reply, issues)
    const row = await prisma.evalSuite.update({
      where: { id },
      data: { name: body.data.name, gate: body.data.gate, scenarios: scenarios as unknown as object },
    })
    return { data: { id: row.id, name: row.name, gate: row.gate, scenarios, updatedAt: row.updatedAt.toISOString() } }
  })

  app.delete('/:botId/evals/:id', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    if (!await ownSuite(tenantId, botId, id)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Suite not found' } })
    await prisma.evalSuite.delete({ where: { id } })
    return reply.status(204).send()
  })

  app.post('/:botId/evals/:id/run', async (request, reply) => {
    const { tenantId, sub } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    const suite = await ownSuite(tenantId, botId, id)
    if (!suite) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Suite not found' } })
    const scenarios = parseEvalScenarios(suite.scenarios)
    if (scenarios.length === 0) return invalid(reply, [{ message: 'Add a scenario before running the suite.' }])
    const working = await workingCopy(botId)
    const snapshot = { ...working, chapters: working.chapters.filter((chapter) => hasSteps(chapter.graph)) }
    if (snapshot.chapters.length === 0) return invalid(reply, [{ message: 'This bot has no chapters to test yet. Add one on the Journey page.' }])
    const run = await runSuite({
      tenantId,
      botId,
      suite,
      snapshot,
      target: { kind: 'working_copy', chapters: snapshot.chapters.map((chapter) => ({ name: chapter.name, version: chapter.version })) },
      trigger: 'manual',
      createdBy: sub,
    })
    return { data: { ...run, createdAt: run.createdAt.toISOString() } }
  })

  app.get('/:botId/evals/:id/runs', async (request, reply) => {
    const { tenantId } = request.user as JWT
    const { botId, id } = request.params as { botId: string; id: string }
    if (!await ownSuite(tenantId, botId, id)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Suite not found' } })
    const runs = await prisma.evalRun.findMany({ where: { suiteId: id }, orderBy: { createdAt: 'desc' }, take: 20 })
    return { data: runs.map((run) => presentRun(run)) }
  })
}
