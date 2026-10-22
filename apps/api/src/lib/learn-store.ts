import { prisma } from '@botstudio/db'
import {
  LEARNING_KEEPS,
  LEARNING_TAG,
  applyLearningRoute,
  inspectFlowGraph,
  learningMeta,
  suggestionFromRated,
  suggestionFromSamples,
  weekSummary,
  type LearnGraph,
  type LearnSuggestion,
  type RatedChatInput,
  type WeekCounts,
} from '@botstudio/shared'
import { messageText } from './draft-flows.js'

export interface LearnCard {
  flowId: string
  version: number
  phrase: string
  sentence: string
  fromLabel: string
  keeps: string
  preview: LearnSuggestion['preview']
}

export interface LearnSnapshot {
  week: WeekCounts
  suggestion: LearnCard | null
  note: string | null
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function learnSnapshot(botId: string, tenantId: string, environmentId: string): Promise<LearnSnapshot> {
  const week = await weekFor(botId, tenantId, environmentId)
  const suggestion = await openSuggestion(botId, tenantId)
  return { week, suggestion, note: null }
}

export async function learnFromSamples(input: {
  botId: string
  tenantId: string
  environmentId: string
  text: string
}): Promise<LearnSnapshot> {
  const company = await companyName(input.botId, input.tenantId)
  const suggestion = suggestionFromSamples(input.text, company)
  const week = await weekFor(input.botId, input.tenantId, input.environmentId)
  if (!suggestion) {
    return { week, suggestion: await openSuggestion(input.botId, input.tenantId), note: 'Paste a full chat that includes what the visitor asked for.' }
  }
  const saved = await saveDraft(input.botId, input.tenantId, suggestion)
  return { week, suggestion: saved.card, note: saved.note }
}

export async function learnFromRated(input: {
  botId: string
  tenantId: string
  environmentId: string
}): Promise<LearnSnapshot> {
  const company = await companyName(input.botId, input.tenantId)
  const { week, chats } = await ratedChats(input.botId, input.tenantId, input.environmentId)
  const suggestion = suggestionFromRated(chats, company)
  if (!suggestion) {
    return {
      week,
      suggestion: await openSuggestion(input.botId, input.tenantId),
      note: 'No repeated request in the helpful chats yet.',
    }
  }
  const saved = await saveDraft(input.botId, input.tenantId, suggestion)
  return { week, suggestion: saved.card, note: saved.note }
}

export async function publishLearningDraft(input: {
  botId: string
  tenantId: string
  flowId: string
  environmentId: string
}): Promise<{ welcomeUpdated: boolean }> {
  const environment = await prisma.environment.findFirst({
    where: { id: input.environmentId, botId: input.botId },
    select: { id: true, kind: true },
  })
  if (!environment || environment.kind !== 'sandbox') {
    throw new LearnError(400, 'Publish this draft to Sandbox first.')
  }
  const flow = await prisma.flow.findFirst({
    where: { id: input.flowId, botId: input.botId, tenantId: input.tenantId },
    include: { versions: { orderBy: { version: 'desc' } } },
  })
  if (!flow || !flow.tags.includes(LEARNING_TAG)) throw new LearnError(404, 'That draft is not on this bot.')
  const draft = flow.versions.find((version) => version.status !== 'published')
  if (!draft) throw new LearnError(409, 'Sandbox already has this change.')
  const meta = learningMeta(draft.graph)
  if (!meta) throw new LearnError(422, 'This draft has no learning note.')

  const names = await prisma.flow.findMany({
    where: { botId: input.botId, tenantId: input.tenantId },
    select: { name: true },
  })
  const flowNames = names.map((item) => item.name)
  const blocking = blockingIssues(draft.graph, flowNames)
  if (blocking.length > 0) throw new LearnError(422, blocking[0] ?? 'This draft still has a gap.')

  const welcome = await prisma.flowVersion.findFirst({
    where: {
      status: 'published',
      environmentId: environment.id,
      flow: {
        botId: input.botId,
        tenantId: input.tenantId,
        OR: [
          { tags: { has: 'welcome' } },
          { name: 'Welcome & Routing' },
          { name: 'Product welcome' },
          { name: 'Salon welcome' },
        ],
      },
    },
    include: { flow: true },
    orderBy: { publishedAt: 'desc' },
  })
  if (!welcome) throw new LearnError(422, 'Publish a welcome on Sandbox before this draft can take a route.')

  const patched = applyLearningRoute(welcome.graph as unknown as LearnGraph, meta.phrase, flow.name)
  if (!graphChanged(welcome.graph, patched)) {
    throw new LearnError(422, 'The welcome chart has no place to add this route yet.')
  }
  const welcomeNames = flowNames.includes(flow.name) ? flowNames : [...flowNames, flow.name]
  const welcomeBlocking = blockingIssues(patched, welcomeNames)
  if (welcomeBlocking.length > 0) throw new LearnError(422, welcomeBlocking[0] ?? 'The welcome chart still has a gap.')

  await prisma.flowVersion.update({
    where: { id: draft.id },
    data: { status: 'published', environmentId: environment.id, publishedAt: new Date() },
  })
  const latest = await prisma.flowVersion.findFirst({
    where: { flowId: welcome.flowId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  await prisma.flowVersion.create({
    data: {
      tenantId: input.tenantId,
      flowId: welcome.flowId,
      version: (latest?.version ?? welcome.version) + 1,
      status: 'published',
      environmentId: environment.id,
      graph: patched as object,
      publishedAt: new Date(),
    },
  })
  return { welcomeUpdated: true }
}

export async function dismissLearningDraft(input: { botId: string; tenantId: string; flowId: string }): Promise<void> {
  const flow = await prisma.flow.findFirst({
    where: { id: input.flowId, botId: input.botId, tenantId: input.tenantId },
    include: { versions: { select: { status: true } } },
  })
  if (!flow || !flow.tags.includes(LEARNING_TAG)) throw new LearnError(404, 'That draft is not on this bot.')
  if (flow.versions.some((version) => version.status === 'published')) {
    throw new LearnError(409, 'Sandbox is already using this draft.')
  }
  await prisma.flow.delete({ where: { id: flow.id } })
}

export class LearnError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function saveDraft(botId: string, tenantId: string, suggestion: LearnSuggestion): Promise<{ card: LearnCard | null; note: string | null }> {
  const existing = await prisma.flow.findFirst({
    where: { botId, tenantId, name: suggestion.flowName },
    include: { versions: { orderBy: { version: 'desc' } } },
  })
  if (existing?.versions.some((version) => version.status === 'published')) {
    return { card: await openSuggestion(botId, tenantId), note: 'Sandbox already has this change.' }
  }
  if (!existing) {
    const flow = await prisma.flow.create({
      data: {
        tenantId,
        botId,
        name: suggestion.flowName,
        description: `${suggestion.sentence}\n${suggestion.fromLabel}`,
        kind: 'flow',
        tags: [LEARNING_TAG],
      },
    })
    const version = await prisma.flowVersion.create({
      data: {
        tenantId,
        flowId: flow.id,
        version: 1,
        status: 'draft',
        graph: suggestion.graph as object,
      },
    })
    return { card: toCard(flow.id, version.version, suggestion), note: null }
  }
  const draft = existing.versions.find((version) => version.status !== 'published') ?? existing.versions[0]
  if (!draft) return { card: null, note: 'This draft could not be saved.' }
  await prisma.flow.update({
    where: { id: existing.id },
    data: {
      description: `${suggestion.sentence}\n${suggestion.fromLabel}`,
      tags: existing.tags.includes(LEARNING_TAG) ? existing.tags : [...existing.tags, LEARNING_TAG],
    },
  })
  await prisma.flowVersion.update({
    where: { id: draft.id },
    data: { graph: suggestion.graph as object, status: 'draft', environmentId: null },
  })
  return { card: toCard(existing.id, draft.version, suggestion), note: null }
}

async function openSuggestion(botId: string, tenantId: string): Promise<LearnCard | null> {
  const flows = await prisma.flow.findMany({
    where: { botId, tenantId, tags: { has: LEARNING_TAG } },
    include: { versions: { orderBy: { version: 'desc' } } },
    orderBy: { updatedAt: 'desc' },
  })
  for (const flow of flows) {
    if (flow.versions.some((version) => version.status === 'published')) continue
    const draft = flow.versions.find((version) => version.status !== 'published')
    const meta = draft ? learningMeta(draft.graph) : null
    if (!draft || !meta) continue
    return {
      flowId: flow.id,
      version: draft.version,
      phrase: meta.phrase,
      sentence: meta.sentence,
      fromLabel: meta.fromLabel,
      keeps: meta.keeps || LEARNING_KEEPS,
      preview: meta.preview,
    }
  }
  return null
}

async function weekFor(botId: string, tenantId: string, environmentId: string): Promise<WeekCounts> {
  const { rows } = await loadWeek(botId, tenantId, environmentId)
  return weekSummary(rows)
}

async function ratedChats(botId: string, tenantId: string, environmentId: string): Promise<{ week: WeekCounts; chats: RatedChatInput[] }> {
  const { rows, chats } = await loadWeek(botId, tenantId, environmentId)
  return { week: weekSummary(rows), chats }
}

async function loadWeek(botId: string, tenantId: string, environmentId: string): Promise<{
  rows: Array<{ finished: boolean; rating: number | null }>
  chats: RatedChatInput[]
}> {
  const since = new Date(Date.now() - WEEK_MS)
  const conversations = await prisma.conversation.findMany({
    where: { botId, tenantId, environmentId, createdAt: { gte: since } },
    select: {
      status: true,
      csatResponses: { select: { rating: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      messages: { select: { authorKind: true, content: true }, orderBy: { createdAt: 'asc' } },
    },
    take: 200,
    orderBy: { createdAt: 'desc' },
  })
  const rows: Array<{ finished: boolean; rating: number | null }> = []
  const chats: RatedChatInput[] = []
  for (const conversation of conversations) {
    const rating = conversation.csatResponses[0]?.rating ?? null
    const finished = conversation.status === 'resolved' || conversation.status === 'closed' || rating !== null
    rows.push({ finished, rating })
    if (rating !== 1 && rating !== -1) continue
    const visitorLines: string[] = []
    const botLines: string[] = []
    for (const message of conversation.messages) {
      const text = messageText(message.content)
      if (!text) continue
      if (message.authorKind === 'user') visitorLines.push(text)
      else if (message.authorKind === 'bot') botLines.push(text)
    }
    chats.push({ rating, visitorLines, botLines })
  }
  return { rows, chats }
}

async function companyName(botId: string, tenantId: string): Promise<string> {
  const bot = await prisma.bot.findFirst({ where: { id: botId, tenantId }, select: { name: true } })
  return bot?.name?.trim() || 'the team'
}

function toCard(flowId: string, version: number, suggestion: LearnSuggestion): LearnCard {
  return {
    flowId,
    version,
    phrase: suggestion.phrase,
    sentence: suggestion.sentence,
    fromLabel: suggestion.fromLabel,
    keeps: suggestion.keeps,
    preview: suggestion.preview,
  }
}

function blockingIssues(graph: unknown, flowNames: string[]): string[] {
  return inspectFlowGraph(graph as { nodes: []; edges: [] }, { flowNames })
    .filter((issue) => issue.level === 'repair' || issue.level === 'block')
    .map((issue) => issue.message)
}

function graphChanged(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}
