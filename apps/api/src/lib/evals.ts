/**
 * Eval runs: each scenario is a scripted test chat over the exact chapters
 * being tested (the working copy, or a release candidate), judged by code.
 *
 * Scenarios go through runTestTurn, the same pipeline Test Bot uses, so
 * nothing reaches the Inbox or analytics. Model calls land in the ledger with
 * source "eval" under one trace id per run, which is how the run's cost is
 * summed.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@ybot/db'
import { judgeScenario, parseEvalScenarios, scenarioPassed, type EvalLine, type EvalScenario, type EvalScenarioResult } from '@ybot/shared'
import type { FlowGraph } from '@ybot/runtime'
import { withLlmScope } from './llm-ledger.js'
import type { JourneySnapshot } from './releases.js'
import { runTestTurn, type TestChatState } from './test-chat.js'

export type EvalTrigger = 'manual' | 'publish'

export interface EvalRunTarget {
  /** "working_copy" or "release_candidate". */
  kind: 'working_copy' | 'release_candidate'
  chapters: Array<{ name: string; version: number }>
}

export interface EvalRunSummary {
  id: string
  suiteId: string
  suiteName: string
  status: 'passed' | 'failed' | 'error'
  passed: number
  failed: number
  costUsd: number | null
  durationMs: number
  results: EvalScenarioResult[]
  trigger: EvalTrigger
  createdAt: Date
}

export interface EvalDeps {
  turn: typeof runTestTurn
  /** Summed ledger cost for a trace, or null when no priced call was recorded. */
  cost: (traceId: string) => Promise<number | null>
  save: (row: {
    tenantId: string
    botId: string
    suiteId: string
    trigger: EvalTrigger
    status: EvalRunSummary['status']
    passed: number
    failed: number
    results: EvalScenarioResult[]
    costUsd: number | null
    durationMs: number
    target: EvalRunTarget
    createdBy?: string
  }) => Promise<{ id: string; createdAt: Date }>
  now: () => number
}

/** Ledger rows are written after the call returns; give them a moment before summing. */
const LEDGER_SETTLE_MS = 400
const PARALLEL_SCENARIOS = 3

async function ledgerCost(traceId: string): Promise<number | null> {
  await new Promise((resolve) => setTimeout(resolve, LEDGER_SETTLE_MS))
  const sum = await prisma.llmCall.aggregate({ where: { traceId }, _sum: { costUsd: true }, _count: true })
  return sum._count > 0 ? (sum._sum.costUsd ?? null) : null
}

const liveDeps: EvalDeps = {
  turn: runTestTurn,
  cost: ledgerCost,
  async save(row) {
    const saved = await prisma.evalRun.create({
      data: { ...row, results: row.results as unknown as object, target: row.target as unknown as object },
      select: { id: true, createdAt: true },
    })
    return saved
  },
  now: () => Date.now(),
}

/** Plays one scenario: the greeting, then each guest message. Stops once a person has the chat. */
export async function playScenario(
  scenario: EvalScenario,
  ctx: { tenantId: string; botId: string; snapshot: JourneySnapshot; environmentLabel: string },
  turn: EvalDeps['turn'],
): Promise<EvalScenarioResult> {
  const transcript: EvalLine[] = []
  const chapters = ctx.snapshot.chapters.map((chapter) => ({ name: chapter.name, graph: chapter.graph as FlowGraph }))
  const base = {
    tenantId: ctx.tenantId,
    botId: ctx.botId,
    chapters,
    startChapter: ctx.snapshot.entry ?? chapters[0]?.name ?? '',
    environmentLabel: ctx.environmentLabel,
    ledgerSource: 'eval' as const,
  }
  let state: TestChatState | undefined
  let status: TestChatState['status'] = 'active'
  try {
    const opening = await turn({ ...base, message: '', opening: true })
    state = opening.state
    if (opening.text.trim()) transcript.push({ role: 'bot', text: opening.text, path: opening.path, chapter: opening.chapter })
    for (const message of scenario.turns.map((line) => line.trim()).filter(Boolean)) {
      if (state.status === 'escalated') break
      transcript.push({ role: 'guest', text: message })
      const reply = await turn({ ...base, message, state })
      state = reply.state
      if (reply.text.trim()) transcript.push({ role: 'bot', text: reply.text, path: reply.path, chapter: reply.chapter })
    }
    status = state.status
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { scenarioId: scenario.id, name: scenario.name, passed: false, checks: [], transcript, error: `The test chat stopped: ${error}` }
  }
  const checks = judgeScenario(scenario, { transcript, status })
  return { scenarioId: scenario.id, name: scenario.name, passed: scenarioPassed(checks), checks, transcript }
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  }
  return out
}

export async function runSuite(opts: {
  tenantId: string
  botId: string
  suite: { id: string; name: string; scenarios: unknown }
  snapshot: JourneySnapshot
  target: EvalRunTarget
  trigger: EvalTrigger
  environmentLabel?: string
  createdBy?: string
}, overrides: Partial<EvalDeps> = {}): Promise<EvalRunSummary> {
  const deps = { ...liveDeps, ...overrides }
  const started = deps.now()
  const traceId = randomUUID()
  const scenarios = parseEvalScenarios(opts.suite.scenarios)
  const ctx = { tenantId: opts.tenantId, botId: opts.botId, snapshot: opts.snapshot, environmentLabel: opts.environmentLabel ?? 'Sandbox' }
  const results = await withLlmScope(
    { source: 'eval', tenantId: opts.tenantId, botId: opts.botId, environment: 'test', traceId },
    () => inBatches(scenarios, PARALLEL_SCENARIOS, (scenario) => playScenario(scenario, ctx, deps.turn)),
  )
  const passed = results.filter((result) => result.passed).length
  const failed = results.length - passed
  const status: EvalRunSummary['status'] = results.some((result) => result.error)
    ? 'error'
    : failed > 0 || results.length === 0 ? 'failed' : 'passed'
  const costUsd = await deps.cost(traceId).catch(() => null)
  const durationMs = Math.max(0, deps.now() - started)
  const saved = await deps.save({
    tenantId: opts.tenantId,
    botId: opts.botId,
    suiteId: opts.suite.id,
    trigger: opts.trigger,
    status,
    passed,
    failed,
    results,
    costUsd,
    durationMs,
    target: opts.target,
    createdBy: opts.createdBy,
  })
  return { id: saved.id, suiteId: opts.suite.id, suiteName: opts.suite.name, status, passed, failed, costUsd, durationMs, results, trigger: opts.trigger, createdAt: saved.createdAt }
}

export interface GateResult {
  passed: boolean
  runs: EvalRunSummary[]
}

/** Runs every gate suite with scenarios against the candidate. No gate suites: the gate is open. */
export async function runGate(opts: {
  tenantId: string
  botId: string
  snapshot: JourneySnapshot
  createdBy?: string
}, overrides: Partial<EvalDeps> & { suites?: Array<{ id: string; name: string; scenarios: unknown }> } = {}): Promise<GateResult> {
  const suites = overrides.suites ?? await prisma.evalSuite.findMany({
    where: { botId: opts.botId, tenantId: opts.tenantId, gate: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, scenarios: true },
  })
  const runnable = suites.filter((suite) => parseEvalScenarios(suite.scenarios).length > 0)
  const target: EvalRunTarget = {
    kind: 'release_candidate',
    chapters: opts.snapshot.chapters.map((chapter) => ({ name: chapter.name, version: chapter.version })),
  }
  const runs: EvalRunSummary[] = []
  for (const suite of runnable) {
    runs.push(await runSuite({ ...opts, suite, target, trigger: 'publish', environmentLabel: 'Production' }, overrides))
  }
  return { passed: runs.every((run) => run.status === 'passed'), runs }
}
