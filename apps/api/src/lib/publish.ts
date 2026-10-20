/**
 * Publishing to Production: check every chapter, run the gate suites against
 * the exact candidate, then save the release. Nothing reaches guests when a
 * check or a gate suite fails.
 */

import { prisma } from '@ybot/db'
import { inspectFlowGraph, type FlowIssue } from '@ybot/shared'
import { runGate, type EvalRunSummary } from './evals.js'
import { createRelease, releaseCandidate, ReleaseError } from './releases.js'

export class PublishBlocked extends Error {
  constructor(
    public code: 'FLOW_CHECK' | 'GATE_FAILED',
    message: string,
    public details: { issues?: Array<FlowIssue & { chapter: string }>; runs?: EvalRunSummary[] },
  ) {
    super(message)
  }
}

export async function publishToProduction(opts: {
  tenantId: string
  botId: string
  environmentId: string
  /** Publish one chapter on top of what is live. Omit to publish the whole working copy. */
  chapterVersionId?: string
  note?: string
  userId?: string
}, gate: typeof runGate = runGate) {
  const candidate = await releaseCandidate(opts.botId, opts.environmentId, opts.chapterVersionId)
  if (candidate.snapshot.chapters.length === 0) {
    throw new ReleaseError(422, 'There is nothing to publish yet. Add a chapter on the Journey page first.', 'EMPTY')
  }
  if (!opts.chapterVersionId && candidate.diff.added.length + candidate.diff.changed.length + candidate.diff.removed.length === 0 && candidate.liveReleaseId) {
    throw new ReleaseError(409, 'Production already plays this version of every chapter. Save a change first.', 'NO_CHANGES')
  }
  const [flows, tools] = await Promise.all([
    prisma.flow.findMany({ where: { botId: opts.botId, tenantId: opts.tenantId }, select: { name: true } }),
    prisma.tool.findMany({ where: { botId: opts.botId, tenantId: opts.tenantId }, select: { id: true } }),
  ])
  const context = { flowNames: flows.map((flow) => flow.name), toolIds: tools.map((tool) => tool.id) }
  const issues = candidate.snapshot.chapters.flatMap((chapter) => inspectFlowGraph(chapter.graph as { nodes: []; edges: [] } | null, context)
    .filter((issue) => issue.level === 'repair' || issue.level === 'block')
    .map((issue) => ({ ...issue, chapter: chapter.name })))
  if (issues.length > 0) {
    const first = issues[0]!
    throw new PublishBlocked('FLOW_CHECK', `${first.chapter}: ${first.message}`, { issues })
  }
  const result = await gate({ tenantId: opts.tenantId, botId: opts.botId, snapshot: candidate.snapshot, createdBy: opts.userId })
  if (!result.passed) {
    const failed = result.runs.filter((run) => run.status !== 'passed')
    const names = failed.map((run) => `"${run.suiteName}"`).join(', ')
    throw new PublishBlocked('GATE_FAILED', `Not published: the gate suite ${names} did not pass. Open Evals to see which scenario failed.`, { runs: result.runs })
  }
  const release = await createRelease({
    tenantId: opts.tenantId,
    botId: opts.botId,
    environmentId: opts.environmentId,
    candidate,
    note: opts.note,
    evalRunIds: result.runs.map((run) => run.id),
    createdBy: opts.userId,
  })
  return { release, gate: result, diff: candidate.diff }
}
