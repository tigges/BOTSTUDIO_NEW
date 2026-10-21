/**
 * Scheduled end-to-end runs. A runner outside the server talks to a live bot the
 * way visitors and people do (the public chat, the Inbox API, releases); this
 * module starts and finishes the run, marks the chats it opens, adds the checks
 * only the database can answer, and prunes old run traffic.
 *
 * Run chats carry `testRunId`, so they can be told apart from real visitors and
 * pruned. They count in the target bot's numbers: the targets are demo and
 * reference bots with no real visitors.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { prisma, withAuditActor } from '@botstudio/db'
import { HANDOVER_PRIORITIES, RETURN_OUTCOMES } from '@botstudio/shared'
import { createLlmAdapter, hasCloudLlm, setLlmOutboundWatch } from '@botstudio/llm'
import { openSecret, sealSecret, secretHint } from './secrets.js'
import { currentLlmScope, withLlmScope } from './llm-ledger.js'
import { DENTAL_REF_BOT_ID, PRACTICE_PLACEHOLDER_BASE, PRACTICE_PROFILE_NAME, SANDBOX_PATH } from './practice-sandbox.js'

export const TEST_RUN_HEADER = 'x-test-run'
export const TEST_RUN_KEEP_DAYS = 14
export const TEST_RUN_TARGETS = ['harbour-dental', 'bella', 'acme'] as const
export type TestRunTarget = typeof TEST_RUN_TARGETS[number]
export const TEST_RUN_KINDS = ['traffic', 'release'] as const
export type TestRunKind = typeof TEST_RUN_KINDS[number]

const DAY = 86_400_000

export interface RunCheck {
  name: string
  ok: boolean
  detail?: string
  conversationId?: string
  /** Who decided it: the runner from what the APIs returned, or the server from the database. */
  by?: 'runner' | 'server'
}

export class TestRunError extends Error {
  constructor(public status: number, message: string, public code = 'TEST_RUN') {
    super(message)
  }
}

/**
 * Personal details the runner types into run chats, watched in every model call
 * those chats make. In memory: the live site runs one API process, and a restart
 * mid-run only loses the watch, never a reply.
 */
interface PrivacyWatch {
  sentinels: string[]
  chats: Set<string>
  inspected: number
  tokenised: number
  leaks: Array<{ conversationId: string; found: string }>
}

const privacyWatches = new Map<string, PrivacyWatch>()
const PII_TOKEN = /\[[A-Z][A-Z0-9_]*_[0-9A-F]{6,}\]/

/** Called by the outbound watch with the text of one model call and the chat it belongs to. */
export function inspectOutbound(text: string, conversationId: string | undefined, watches = privacyWatches): void {
  if (!conversationId) return
  for (const watch of watches.values()) {
    if (!watch.chats.has(conversationId)) continue
    watch.inspected++
    if (PII_TOKEN.test(text)) watch.tokenised++
    for (const sentinel of watch.sentinels) {
      if (text.includes(sentinel)) watch.leaks.push({ conversationId, found: sentinel.replace(/[^\s@.]/g, (ch, i) => (i < 2 ? ch : '•')) })
    }
  }
}

setLlmOutboundWatch((text) => inspectOutbound(text, currentLlmScope()?.conversationId ?? undefined))

/** The widget calls this when it opens a chat for a running run. */
export function noteRunChat(runId: string, conversationId: string): void {
  privacyWatches.get(runId)?.chats.add(conversationId)
}

export function privacyCheck(watch: PrivacyWatch | undefined): RunCheck | undefined {
  if (!watch) return undefined
  return {
    name: 'Models never received the visitors\' personal details in plain text',
    ok: watch.leaks.length === 0,
    detail: watch.leaks.length
      ? `${watch.leaks.length} model calls carried ${[...new Set(watch.leaks.map((leak) => leak.found))].join(', ')}`
      : `${watch.inspected} model calls in run chats inspected, ${watch.tokenised} carried tokens in place of personal details`,
    ...(watch.leaks[0] ? { conversationId: watch.leaks[0].conversationId } : {}),
    by: 'server',
  }
}

export function watchRun(runId: string, sentinels: string[], watches = privacyWatches): PrivacyWatch {
  const watch: PrivacyWatch = { sentinels: sentinels.filter((value) => value.trim().length >= 5), chats: new Set(), inspected: 0, tokenised: 0, leaks: [] }
  watches.set(runId, watch)
  return watch
}

function runSecret(): string | undefined {
  const env = process.env
  const secret = env['TEST_RUN_SECRET'] || env['JWT_SECRET'] || env['SEED_DEMO_SECRET']
  if (secret) return secret
  return env['NODE_ENV'] === 'production' ? undefined : 'local-test-runs'
}

function mac(runId: string, secret: string): string {
  return createHmac('sha256', secret).update(`test-run:${runId}`).digest('base64url').slice(0, 32)
}

/** The header value the runner sends with each visitor message, so the chat is marked as run traffic. */
export function signRunToken(runId: string, secret = runSecret()): string {
  if (!secret) throw new TestRunError(503, 'Test runs need TEST_RUN_SECRET or JWT_SECRET on the server.', 'NO_SECRET')
  return `${runId}.${mac(runId, secret)}`
}

/** The run id when the token was signed by this server, else undefined. A visitor cannot mark their own chat. */
export function verifyRunToken(token: unknown, secret = runSecret()): string | undefined {
  if (typeof token !== 'string' || !secret) return undefined
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return undefined
  const runId = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(mac(runId, secret))
  return given.length === expected.length && timingSafeEqual(given, expected) ? runId : undefined
}

/** A running run's id for this bot, from the header on a public chat request. */
export async function runForChat(header: unknown, botId: string): Promise<string | undefined> {
  const runId = verifyRunToken(Array.isArray(header) ? header[0] : header)
  if (!runId) return undefined
  const run = await prisma.testRun.findUnique({ where: { id: runId }, select: { botId: true, status: true } })
  return run?.botId === botId && run.status === 'running' ? runId : undefined
}

async function targetBot(target: TestRunTarget) {
  if (target === 'harbour-dental') return prisma.bot.findUnique({ where: { id: DENTAL_REF_BOT_ID }, select: { id: true, tenantId: true, name: true } })
  if (target === 'bella') return prisma.bot.findUnique({ where: { id: 'bella-bot' }, select: { id: true, tenantId: true, name: true } })
  const owner = await prisma.user.findFirst({ where: { email: { in: ['charles@acme.com', 'demo@acme.com'] } }, orderBy: { createdAt: 'asc' }, select: { tenantId: true } })
  if (!owner) return null
  return prisma.bot.findFirst({ where: { tenantId: owner.tenantId, name: 'Acme Support Bot' }, select: { id: true, tenantId: true, name: true } })
}

async function auditUser(tenantId: string, userId?: string): Promise<string | undefined> {
  if (userId) return userId
  const admin = await prisma.membership.findFirst({ where: { tenantId, role: 'ADMIN' }, orderBy: { id: 'asc' }, select: { userId: true } })
  return admin?.userId
}

function asSystem<T>(tenantId: string, userId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return userId ? withAuditActor({ tenantId, userId, source: 'system' }, fn) : fn()
}

/** Gives the practice system profile a key and points the reference HTTP tools at the sandbox on this server. */
export async function ensurePracticeSandbox(tenantId: string, baseUrl: string) {
  const origin = new URL(baseUrl).origin
  const sandbox = `${origin}${SANDBOX_PATH}`
  let profile = await prisma.authProfile.findUnique({ where: { tenantId_name: { tenantId, name: PRACTICE_PROFILE_NAME } } })
  if (!profile) return { profile: 'missing', toolsMoved: 0 }
  if (!profile.secretEnc) {
    const key = `hd_test_${randomBytes(18).toString('base64url')}`
    profile = await prisma.authProfile.update({ where: { id: profile.id }, data: { secretEnc: sealSecret(key), secretHint: secretHint(key) } })
  }
  const tools = await prisma.tool.findMany({ where: { botId: DENTAL_REF_BOT_ID, kind: 'http' }, select: { id: true, config: true } })
  let toolsMoved = 0
  for (const tool of tools) {
    const config = (tool.config ?? {}) as Record<string, unknown>
    const url = typeof config['url'] === 'string' ? config['url'] : ''
    const path = url.startsWith(PRACTICE_PLACEHOLDER_BASE)
      ? url.slice(PRACTICE_PLACEHOLDER_BASE.length)
      : url.includes(SANDBOX_PATH) ? url.slice(url.indexOf(SANDBOX_PATH) + SANDBOX_PATH.length) : null
    if (path === null || `${sandbox}${path}` === url) continue
    await prisma.tool.update({ where: { id: tool.id }, data: { config: { ...config, url: `${sandbox}${path}` } } })
    toolsMoved++
  }
  return { profile: 'ready', toolsMoved }
}

export async function startTestRun(input: {
  target: TestRunTarget
  kind: TestRunKind
  seed?: string
  baseUrl?: string
  /** Synthetic personal details the runner will type; no model call in a run chat may carry them in plain text. */
  sentinels?: string[]
  /** The signed-in caller. Missing when the server secret was used. */
  caller?: { userId: string; tenantId: string }
}) {
  const bot = await targetBot(input.target)
  if (!bot) throw new TestRunError(404, `The ${input.target} bot is not in this database.`, 'NO_BOT')
  if (input.caller && input.caller.tenantId !== bot.tenantId) {
    throw new TestRunError(403, `Sign in to the workspace that owns ${bot.name} to run it.`, 'FORBIDDEN')
  }
  const environment = await prisma.environment.findFirst({ where: { botId: bot.id, kind: 'production' }, select: { id: true, liveReleaseId: true } })
  if (!environment) throw new TestRunError(422, `${bot.name} has no Production environment.`, 'NO_PRODUCTION')
  const channel = await prisma.channel.findFirst({
    where: { botId: bot.id, environmentId: environment.id, kind: 'web', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, allowedDomains: true },
  })
  if (!channel) throw new TestRunError(422, `${bot.name} has no website chat on Production. Add one under Channels.`, 'NO_CHANNEL')
  const userId = await auditUser(bot.tenantId, input.caller?.userId)
  const harness = input.target === 'harbour-dental' && input.baseUrl
    ? await asSystem(bot.tenantId, userId, () => ensurePracticeSandbox(bot.tenantId, input.baseUrl!))
    : null
  const run = await prisma.testRun.create({
    data: {
      tenantId: bot.tenantId,
      botId: bot.id,
      kind: input.kind,
      seed: input.seed?.trim() || new Date().toISOString().slice(0, 13),
      startedBy: input.caller?.userId ?? null,
    },
  })
  if (input.sentinels?.length) watchRun(run.id, input.sentinels)
  await prisma.activity.create({
    data: { tenantId: bot.tenantId, userId: input.caller?.userId ?? null, action: 'test_run.started', resource: 'bot', resourceId: bot.id, metadata: { runId: run.id, kind: run.kind, seed: run.seed } },
  }).catch(() => {})
  return {
    runId: run.id,
    token: signRunToken(run.id),
    seed: run.seed,
    botId: bot.id,
    botName: bot.name,
    environmentId: environment.id,
    liveReleaseId: environment.liveReleaseId,
    channelId: channel.id,
    allowedDomains: channel.allowedDomains,
    harness,
  }
}

async function runningRun(runId: string) {
  const run = await prisma.testRun.findUnique({ where: { id: runId } })
  if (!run) throw new TestRunError(404, 'That test run does not exist.', 'NO_RUN')
  return run
}

/** The checks only the database can answer, for every chat the run opened. */
export async function serverChecks(runId: string, botId: string, reported: string[], since: Date): Promise<{ checks: RunCheck[]; summary: Record<string, unknown> }> {
  const conversations = await prisma.conversation.findMany({
    where: { testRunId: runId },
    select: { id: true, status: true, outcome: true, handover: true, messages: { select: { authorKind: true } }, _count: { select: { stepLogs: true } } },
  })
  const checks: RunCheck[] = []
  const add = (check: Omit<RunCheck, 'by'>) => checks.push({ ...check, by: 'server' })
  const marked = new Set(conversations.map((row) => row.id))
  const unmarked = reported.filter((id) => !marked.has(id))
  add({ name: 'Every run chat is marked as test traffic', ok: unmarked.length === 0 && conversations.length > 0, detail: unmarked.length ? `Not marked: ${unmarked.join(', ')}` : `${conversations.length} chats` })

  const flows = await prisma.flow.count({ where: { botId } })
  for (const row of conversations) {
    const spoke = row.messages.some((m) => m.authorKind === 'bot')
    if (!spoke) add({ name: 'The bot answered', ok: false, conversationId: row.id, detail: 'No bot message was saved.' })
    if (flows > 0 && spoke && row._count.stepLogs === 0) add({ name: 'Journey traffic was logged', ok: false, conversationId: row.id, detail: 'The chat has bot replies but no step log, so Journey traffic misses it.' })
    if (row.handover) {
      const problems = handoverProblems(row.handover)
      add({ name: 'Handover payload is complete', ok: problems.length === 0, conversationId: row.id, detail: problems.join('; ') || undefined })
    }
  }
  if (conversations.every((row) => row.messages.some((m) => m.authorKind === 'bot'))) add({ name: 'The bot answered every run chat', ok: true })
  if (flows > 0 && conversations.every((row) => row._count.stepLogs > 0 || !row.messages.some((m) => m.authorKind === 'bot'))) add({ name: 'Journey traffic logged every run chat', ok: true })

  const ids = conversations.map((row) => row.id)
  const calls = await prisma.llmCall.findMany({
    where: { OR: [{ conversationId: { in: ids } }, { traceId: runId }] },
    select: { conversationId: true, source: true, provider: true, model: true, traceId: true, costUsd: true },
  })
  const chatCalls = calls.filter((call) => call.conversationId)
  const incomplete = chatCalls.filter((call) => !call.provider || !call.model || !call.source || !call.traceId)
  add({ name: 'Every model call in a run chat has a full ledger row', ok: incomplete.length === 0, detail: `${chatCalls.length} calls${incomplete.length ? `, ${incomplete.length} missing model, provider, source or trace` : ''}` })
  const simulator = calls.filter((call) => call.traceId === runId)
  const leaked = simulator.filter((call) => call.conversationId)
  add({ name: 'Simulated visitors are not billed to the chats', ok: leaked.length === 0, detail: `${simulator.length} simulator calls, source eval` })

  const secrets = await practiceSecrets(botId)
  if (secrets.length) {
    const runs = await prisma.toolRun.findMany({ where: { tool: { botId }, createdAt: { gte: since } }, select: { input: true, output: true, error: true } })
    const leaks = runs.filter((run) => secrets.some((secret) => JSON.stringify([run.input, run.output, run.error]).includes(secret)))
    add({ name: 'Credentials never appear in tool runs', ok: leaks.length === 0, detail: `${runs.length} tool runs checked` })
  }

  const sum = (rows: typeof calls) => rows.reduce((total, call) => total + (call.costUsd ?? 0), 0)
  return {
    checks,
    summary: {
      chats: conversations.length,
      handedOver: conversations.filter((row) => row.handover).length,
      outcomes: Object.fromEntries([...new Set(conversations.map((row) => row.outcome ?? 'open'))].map((key) => [key, conversations.filter((row) => (row.outcome ?? 'open') === key).length])),
      modelCalls: chatCalls.length,
      chatCostUsd: Number(sum(chatCalls).toFixed(6)),
      simulatorCalls: simulator.length,
      simulatorCostUsd: Number(sum(simulator).toFixed(6)),
    },
  }
}

export function handoverProblems(raw: unknown): string[] {
  const h = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const routing = (h['routing'] && typeof h['routing'] === 'object' ? h['routing'] : {}) as Record<string, unknown>
  const problems: string[] = []
  if (typeof h['reason'] !== 'string' || !h['reason'].trim()) problems.push('no reason')
  if (!(HANDOVER_PRIORITIES as readonly string[]).includes(String(h['priority']))) problems.push(`priority "${String(h['priority'])}" is not low, medium, high or critical`)
  if (!Array.isArray(h['tags'])) problems.push('no tags list')
  if (typeof h['summary'] !== 'string' || !h['summary'].trim()) problems.push('no summary')
  if (!h['variables'] || typeof h['variables'] !== 'object' || Array.isArray(h['variables'])) problems.push('no variables')
  if (typeof routing['queue'] !== 'string' || !routing['queue']) problems.push('no routing queue')
  if (!Array.isArray(routing['skills'])) problems.push('no routing skills')
  if (typeof routing['priority'] !== 'number') problems.push('no numeric routing priority')
  if (h['context'] !== 'full_transcript' && h['context'] !== 'summary_only') problems.push('no transcript setting')
  const returned = h['returned'] as Record<string, unknown> | undefined
  if (returned && !(RETURN_OUTCOMES as readonly string[]).includes(String(returned['outcome']))) problems.push(`return outcome "${String(returned['outcome'])}" is not resolved, needs_bot or needs_follow_up`)
  return problems
}

async function practiceSecrets(botId: string): Promise<string[]> {
  const tools = await prisma.tool.findMany({ where: { botId, authProfileId: { not: null } }, select: { authProfile: { select: { secretEnc: true } } } })
  const sealed = [...new Set(tools.map((tool) => tool.authProfile?.secretEnc).filter((value): value is string => Boolean(value)))]
  return sealed.flatMap((value) => { try { return [openSecret(value)] } catch { return [] } })
}

/** Deletes run chats older than the keep window for this bot. Tickets go first; messages and step logs cascade. */
export async function pruneTestRuns(botId: string, now = new Date()) {
  const before = new Date(now.getTime() - TEST_RUN_KEEP_DAYS * DAY)
  const stale = await prisma.conversation.findMany({ where: { botId, testRunId: { not: null }, createdAt: { lt: before } }, select: { id: true } })
  if (stale.length === 0) return 0
  const ids = stale.map((row) => row.id)
  await prisma.ticket.deleteMany({ where: { conversationId: { in: ids } } })
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } })
  return ids.length
}

/** Chat and simulator model cost together must stay under the ceiling, so a prompt or model change that gets expensive fails the run. */
export function costCheck(summary: Record<string, unknown>, maxCostUsd: number): RunCheck {
  const chat = typeof summary['chatCostUsd'] === 'number' ? summary['chatCostUsd'] : 0
  const simulator = typeof summary['simulatorCostUsd'] === 'number' ? summary['simulatorCostUsd'] : 0
  const total = chat + simulator
  return {
    name: `The run's model cost stays under $${maxCostUsd.toFixed(2)}`,
    ok: total <= maxCostUsd,
    detail: `$${total.toFixed(4)} (chats $${chat.toFixed(4)}, simulated visitors $${simulator.toFixed(4)})`,
    by: 'server',
  }
}

export async function finishTestRun(runId: string, input: { checks: RunCheck[]; summary: Record<string, unknown>; conversationIds: string[]; maxCostUsd?: number }) {
  const run = await runningRun(runId)
  if (run.status !== 'running') throw new TestRunError(409, 'This test run has already finished.', 'FINISHED')
  const server = await serverChecks(run.id, run.botId, input.conversationIds, run.startedAt)
  const userId = await auditUser(run.tenantId, run.startedBy ?? undefined)
  const pruned = await asSystem(run.tenantId, userId, () => pruneTestRuns(run.botId))
  const checks = [...input.checks.map((check) => ({ ...check, by: 'runner' as const })), ...server.checks]
  if (input.maxCostUsd !== undefined) checks.push(costCheck(server.summary, input.maxCostUsd))
  const privacy = privacyCheck(privacyWatches.get(run.id))
  if (privacy) checks.push(privacy)
  privacyWatches.delete(run.id)
  const passed = checks.every((check) => check.ok)
  const summary = { ...input.summary, ...server.summary, pruned, failed: checks.filter((check) => !check.ok).length, total: checks.length }
  const saved = await prisma.testRun.update({
    where: { id: run.id },
    data: { status: passed ? 'passed' : 'failed', finishedAt: new Date(), checks: checks as unknown as object[], summary: summary as object },
  })
  await prisma.activity.create({
    data: { tenantId: run.tenantId, userId: run.startedBy, action: passed ? 'test_run.passed' : 'test_run.failed', resource: 'bot', resourceId: run.botId, metadata: { runId: run.id, kind: run.kind, failed: summary.failed, total: summary.total } },
  }).catch(() => {})
  return { id: saved.id, status: saved.status, kind: saved.kind, startedAt: saved.startedAt, finishedAt: saved.finishedAt, summary, checks }
}

export async function listTestRuns(botId: string, tenantId: string, take = 20) {
  return prisma.testRun.findMany({ where: { botId, tenantId }, orderBy: { startedAt: 'desc' }, take })
}

const SIMULATOR_RULES = [
  'You are role-playing a member of the public writing to a business on its website chat.',
  'Write only your next message as that person: one or two short sentences, plain and natural, the way people type into a chat box.',
  'Stay in character. Never mention that you are an AI or a test. Do not invent a different business.',
  'When your goal is met, or a person from the business has taken over and you have nothing to add, reply with exactly DONE.',
].join(' ')

/** The simulated visitor's next line. Billed as an eval call on the run's trace, never to the chat. */
export async function nextVisitorLine(runId: string, input: { persona: string; goal: string; transcript: Array<{ from: 'visitor' | 'bot' | 'person'; text: string }> }) {
  const run = await runningRun(runId)
  if (run.status !== 'running') throw new TestRunError(409, 'This test run has already finished.', 'FINISHED')
  if (!hasCloudLlm()) throw new TestRunError(503, 'No cloud model is configured on this server, so generated visitors are skipped.', 'NO_MODEL')
  const llm = createLlmAdapter()
  const system = `${SIMULATOR_RULES}\n\nWho you are: ${input.persona.slice(0, 400)}\nYour goal: ${input.goal.slice(0, 400)}`
  const turns = input.transcript.slice(-20).map((line) => ({
    role: line.from === 'visitor' ? 'assistant' as const : 'user' as const,
    content: line.text.slice(0, 600),
  }))
  if (turns.length === 0 || turns[0]!.role === 'assistant') turns.unshift({ role: 'user', content: '(The chat window opens.)' })
  const result = await withLlmScope({ source: 'eval', tenantId: run.tenantId, botId: run.botId, environment: 'test', traceId: run.id }, () =>
    llm.complete({ messages: [{ role: 'system', content: system }, ...turns], temperature: 0.8, maxTokens: 80 }))
  const text = result.content.trim().replace(/^["']|["']$/g, '')
  return { text, done: text === '' || /^DONE\.?$/i.test(text) }
}
