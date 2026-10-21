/**
 * Scheduled end-to-end runs and the stand-in practice system they call.
 *
 * POST /api/v1/system/test-runs                 { target, kind, seed?, baseUrl? } start a run
 * POST /api/v1/system/test-runs/:id/visitor     { persona, goal, transcript } a generated visitor's next line
 * POST /api/v1/system/test-runs/:id/finish      { checks, summary, conversationIds, maxCostUsd? } add server checks and save
 * GET  /api/v1/system/test-runs?target=         recent runs for a target bot
 *
 * GET  /api/v1/public/practice-sandbox/harbour-dental/v1/slots?type=&date=
 * POST /api/v1/public/practice-sandbox/harbour-dental/v1/holds
 *
 * Run endpoints take SEED_DEMO_SECRET or an admin signed in to the bot's workspace.
 */

import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ybot/db'
import { openSecret } from '../lib/secrets.js'
import { DENTAL_REF_BOT_ID, PRACTICE_PROFILE_NAME, SandboxHolds, sandboxSlots } from '../lib/practice-sandbox.js'
import {
  TEST_RUN_KINDS,
  TEST_RUN_TARGETS,
  TestRunError,
  finishTestRun,
  listTestRuns,
  nextVisitorLine,
  startTestRun,
} from '../lib/test-runs.js'

type Caller = { userId: string; tenantId: string } | undefined

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function sendRunError(reply: FastifyReply, err: unknown) {
  if (err instanceof TestRunError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } })
  throw err
}

const CHECK = z.object({
  name: z.string().min(1).max(200),
  ok: z.boolean(),
  detail: z.string().max(2000).optional(),
  conversationId: z.string().max(64).optional(),
})

export async function testRunRoutes(app: FastifyInstance) {
  /** The signed-in admin, `undefined` for the server secret, or null when neither. */
  async function callerOf(authorization: string | undefined): Promise<Caller | null> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
    if (!token) return null
    const secret = process.env['SEED_DEMO_SECRET']
    if (secret && sameText(token, secret)) return undefined
    try {
      const payload = await app.jwt.verify<{ sub: string; tenantId: string; role?: string }>(token)
      return payload.role === 'ADMIN' ? { userId: payload.sub, tenantId: payload.tenantId } : null
    } catch {
      return null
    }
  }

  async function runInScope(runId: string, caller: Caller) {
    const run = await prisma.testRun.findUnique({ where: { id: runId }, select: { tenantId: true } })
    if (!run) throw new TestRunError(404, 'That test run does not exist.', 'NO_RUN')
    if (caller && caller.tenantId !== run.tenantId) throw new TestRunError(404, 'That test run does not exist.', 'NO_RUN')
  }

  const forbidden = (reply: FastifyReply) =>
    reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Send SEED_DEMO_SECRET or sign in as an admin of the bot\'s workspace.' } })

  app.post('/system/test-runs', async (request, reply) => {
    const caller = await callerOf(request.headers.authorization)
    if (caller === null) return forbidden(reply)
    const body = z.object({
      target: z.enum(TEST_RUN_TARGETS),
      kind: z.enum(TEST_RUN_KINDS).default('traffic'),
      seed: z.string().max(80).optional(),
      baseUrl: z.string().url().refine((value) => /^https?:/.test(value), 'baseUrl must be http or https').optional(),
      sentinels: z.array(z.string().min(5).max(120)).max(30).optional(),
    }).safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'target must be harbour-dental, bella or acme; kind traffic or release.', details: body.error.flatten() } })
    try {
      return reply.status(201).send({ data: await startTestRun({ ...body.data, caller }) })
    } catch (err) {
      return sendRunError(reply, err)
    }
  })

  app.post('/system/test-runs/:id/visitor', async (request, reply) => {
    const caller = await callerOf(request.headers.authorization)
    if (caller === null) return forbidden(reply)
    const { id } = request.params as { id: string }
    const body = z.object({
      persona: z.string().min(1).max(400),
      goal: z.string().min(1).max(400),
      transcript: z.array(z.object({ from: z.enum(['visitor', 'bot', 'person']), text: z.string().max(4000) })).max(60).default([]),
    }).safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Send a persona, a goal and the transcript so far.' } })
    try {
      await runInScope(id, caller)
      return { data: await nextVisitorLine(id, body.data) }
    } catch (err) {
      return sendRunError(reply, err)
    }
  })

  app.post('/system/test-runs/:id/finish', async (request, reply) => {
    const caller = await callerOf(request.headers.authorization)
    if (caller === null) return forbidden(reply)
    const { id } = request.params as { id: string }
    const body = z.object({
      checks: z.array(CHECK).max(500).default([]),
      summary: z.record(z.unknown()).default({}),
      conversationIds: z.array(z.string().max(64)).max(200).default([]),
      maxCostUsd: z.number().positive().max(100).optional(),
    }).safeParse(request.body ?? {})
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Send the runner checks as { name, ok, detail? }.', details: body.error.flatten() } })
    try {
      await runInScope(id, caller)
      return { data: await finishTestRun(id, body.data) }
    } catch (err) {
      return sendRunError(reply, err)
    }
  })

  app.get('/system/test-runs', async (request, reply) => {
    const caller = await callerOf(request.headers.authorization)
    if (caller === null) return forbidden(reply)
    const q = request.query as Record<string, string>
    const botId = q['botId'] ?? DENTAL_REF_BOT_ID
    const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { tenantId: true } })
    if (!bot || (caller && caller.tenantId !== bot.tenantId)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found.' } })
    return { data: await listTestRuns(botId, bot.tenantId) }
  })

  const holds = new SandboxHolds()

  /** The sandbox accepts only the key sealed in the reference bot's practice system profile. */
  async function sandboxKeyOk(given: unknown): Promise<boolean> {
    if (typeof given !== 'string' || !given) return false
    const bot = await prisma.bot.findUnique({ where: { id: DENTAL_REF_BOT_ID }, select: { tenantId: true } })
    if (!bot) return false
    const profile = await prisma.authProfile.findUnique({ where: { tenantId_name: { tenantId: bot.tenantId, name: PRACTICE_PROFILE_NAME } }, select: { secretEnc: true } })
    if (!profile?.secretEnc) return false
    try { return sameText(given, openSecret(profile.secretEnc)) } catch { return false }
  }

  const unauthorised = (reply: FastifyReply) =>
    reply.status(401).send({ error: 'Missing or wrong X-Api-Key. Check the key in the Auth Profile "Harbour Dental practice system".' })

  app.get('/public/practice-sandbox/harbour-dental/v1/slots', async (request, reply) => {
    if (!(await sandboxKeyOk(request.headers['x-api-key']))) return unauthorised(reply)
    const q = request.query as Record<string, string>
    const result = sandboxSlots(q['type'], q['date'])
    return reply.status(result.status).send(result.body)
  })

  app.post('/public/practice-sandbox/harbour-dental/v1/holds', async (request, reply) => {
    if (!(await sandboxKeyOk(request.headers['x-api-key']))) return unauthorised(reply)
    const key = request.headers['idempotency-key']
    const result = holds.hold(request.body, Array.isArray(key) ? key[0] : key)
    return reply.status(result.status).send(result.body)
  })
}
