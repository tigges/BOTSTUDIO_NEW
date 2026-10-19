/**
 * flow-runner.ts
 *
 * The journey stage of a bot turn. The newest saved welcome is the entry. An
 * execute_flow node jumps into that chapter's newest saved graph.
 *
 * Every read and write goes through a JourneyStore. Live chats use Postgres
 * (flow_sessions, step_logs, tickets); Journey Test and Test Bot use an
 * in-memory store over the working copy, so a test walks the same code.
 */

import { randomUUID } from 'node:crypto'
import { SessionMachine, acceptedHoursOffer, hoursChapterName, copyJumpVariables, missingChapterLine, hearChapter, offerOnMap, isSmallTalk, isTopicSwitch, sameQuestion, questionFrom, keepFirstQuestion, shapeTurn } from '@ybot/runtime'
import type { Session, SessionVariables, FlowGraph } from '@ybot/runtime'
import { prisma } from '@ybot/db'
import { CATALOG_ENTITY, catalogFromValues, type HandoverRequest, type StudioCatalog } from '@ybot/shared'
import { createLlmAdapter, createLlmAdapterForModel } from '@ybot/llm'
import { newestByFlow, pickWorkingCopy } from './entry-flow.js'
import { runFlowTurn } from './flow-turn.js'
import { finishBotLines, nameThanksEndsTurn, saveContactName, takeNameTurn, type NamePlan, type VisitorName } from './visitor-name.js'
import { reopenForBot, resolveByBot } from './chat-outcome.js'

const defaultLlm = createLlmAdapter()

export interface FlowRunResult {
  handled: boolean
  messages: string[]
  /** The journey asked for a person. The turn pipeline decides whether anyone is there. */
  handover?: HandoverRequest
  ticket?: { subject: string; description?: string }
  waitingFor?: Session['waitingFor']
  /** The published flow reached its end. A waiting question is still open. */
  ended?: boolean
  flowName?: string
}

export type VersionRow = {
  id: string
  flowId: string
  graph: unknown
  flow: { name: string; tags: string[] }
}

export interface SavedSession {
  id: string
  botId: string
  tenantId: string
  flowId: string
  flowVersionId: string
  currentNodeId: string
  variables: unknown
  status: string
  waitingFor: unknown
  createdAt: Date
  updatedAt: Date
}

export interface SessionWrite {
  id: string
  flowId: string
  flowVersionId: string
  currentNodeId: string
  variables: SessionVariables
  status: Session['status']
  waitingFor?: Session['waitingFor']
}

export interface StepLogWrite {
  flowVersionId: string
  nodeId: string
  nodeKind: string
  input?: object
  output?: object
}

export type JourneyLlm = ReturnType<typeof createLlmAdapter>

/** Where a journey reads its chapters and keeps its place. */
export interface JourneyStore {
  /** The chat's environment, or null when it has none (the journey does not run). */
  chat(): Promise<{ environmentLabel: string; subject: string | null } | null>
  nameTurn(userText: string): Promise<NamePlan & { contact: VisitorName | null }>
  saveContactName(contactId: string, change: { metadata?: Record<string, unknown> }): Promise<void>
  loadSession(): Promise<SavedSession | null>
  saveSession(session: SessionWrite): Promise<void>
  clearSession(): Promise<void>
  entry(): Promise<VersionRow | undefined>
  version(id: string): Promise<VersionRow | null>
  chapter(name: string): Promise<VersionRow | null>
  chapters(): Promise<Array<{ name: string; graph: FlowGraph }>>
  llm(): Promise<JourneyLlm>
  catalog(): Promise<StudioCatalog | undefined>
  db(): unknown
  /** The clock the steps read (slots, opening hours). Live chats use the real one. */
  now?: () => Date
  reopen(): Promise<void>
  resolved(): Promise<void>
  setSubject(subject: string): Promise<void>
  logStep(row: StepLogWrite): Promise<void>
  createTicket(ticket: { subject: string; description: string }): Promise<void>
}

function startNodeId(graph: FlowGraph): string | undefined {
  return graph.nodes.find((node) => node.data.kind === 'trigger_start' || node.data.kind === 'start')?.id
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function savedQuestion(waiting: unknown): string | undefined {
  const question = asRecord(waiting)['question']
  return typeof question === 'string' ? question : undefined
}

/** When the chart is silent, stay on the map instead of handing the turn to RAG. */
export function silentMapReply(
  chapters: Array<{ name: string; graph: FlowGraph }>,
  current?: string,
): string | undefined {
  if (chapters.length === 0) return undefined
  return offerOnMap(chapters, current)
}

/** A saved session from an older chart may not have flow, global, and contact. */
export function resumeVariables(raw: unknown, userText: string, contactName: string): SessionVariables {
  const record = asRecord(raw)
  const flow = asRecord(record['flow'])
  const global = asRecord(record['global'])
  const contact = asRecord(record['contact'])
  flow['_last_user_message'] = userText
  contact['name'] = contactName
  return { flow, global, contact }
}

export async function runFlowIfPublished(opts: {
  conversationId: string
  botId: string
  tenantId: string
  userText: string
}): Promise<FlowRunResult> {
  return runJourney(postgresJourneyStore(opts), opts)
}

/** One journey turn against any store. */
export async function runJourney(store: JourneyStore, opts: {
  conversationId: string
  botId: string
  tenantId: string
  userText: string
}): Promise<FlowRunResult> {
  const { conversationId, botId, tenantId, userText } = opts
  const named = await store.nameTurn(userText)
  const waiting = named.thanks ? await store.loadSession() : null
  if (nameThanksEndsTurn(named.thanks, waiting?.status)) {
    return { handled: true, messages: [named.thanks!] }
  }

  const convo = await store.chat()
  if (!convo) return { handled: false, messages: [] }
  await store.reopen()
  const environmentLabel = convo.environmentLabel

  let fsRecord = await store.loadSession()
  let active = fsRecord
    ? await store.version(fsRecord.flowVersionId)
    : await store.entry()
  if (!active) return { handled: false, messages: [] }

  const llmAdapter = await store.llm()
  const catalog = await store.catalog()
  const machine = new SessionMachine({ llm: llmAdapter, db: store.db() as never, httpFetch: fetch, catalog, now: store.now })
  const loadChapters = () => store.chapters()
  const previousAsked = savedQuestion(fsRecord?.waitingFor)

  let first
  try {
    if (fsRecord && (fsRecord.status === 'completed' || fsRecord.status === 'handed_over')) {
      const map = await loadChapters()
      const nextName = !isSmallTalk(userText)
        ? await hearChapter({ chapters: map, catalog, text: userText, current: active.flow.name }, llmAdapter)
        : undefined
      const target = nextName
        ? await store.chapter(nextName)
        : null
      if (target) {
        first = await runVersion(store, {
          machine,
          version: target,
          fsRecord: null,
          conversationId,
          botId,
          tenantId,
          userText,
          contactName: named.spoken,
          seedVariables: copyJumpVariables(resumeVariables(fsRecord.variables, userText, named.spoken), userText, named.spoken),
        })
        if (first) {
          active = target
          fsRecord = null
        }
      }
      if (!first) {
        return { handled: true, messages: [offerOnMap(map, active.flow.name)], flowName: active.flow.name }
      }
    } else if (fsRecord && acceptedHoursOffer(previousAsked, userText)) {
      const hoursName = hoursChapterName(await loadChapters())
      const target = hoursName && hoursName !== active.flow.name ? await store.chapter(hoursName) : null
      if (target) {
        first = await runVersion(store, {
          machine,
          version: target,
          fsRecord: null,
          conversationId,
          botId,
          tenantId,
          userText,
          contactName: named.spoken,
          seedVariables: copyJumpVariables(resumeVariables(fsRecord.variables, userText, named.spoken), userText, named.spoken),
        })
        if (first) {
          active = target
          fsRecord = null
        }
      }
    }
    if (!first) {
      first = await runVersion(store, {
        machine,
        version: active,
        fsRecord,
        conversationId,
        botId,
        tenantId,
        userText,
        contactName: named.spoken,
      })
    }
  } catch (error) {
    if (!fsRecord) throw error
    await store.clearSession()
    const entry = await store.entry()
    if (!entry) throw error
    fsRecord = null
    active = entry
    first = await runVersion(store, {
      machine,
      version: entry,
      fsRecord: null,
      conversationId,
      botId,
      tenantId,
      userText,
      contactName: named.spoken,
    })
  }
  if (!first) {
    const map = await loadChapters()
    const offer = silentMapReply(map, active.flow.name)
    if (offer) return { handled: true, messages: [offer], flowName: active.flow.name }
    return { handled: false, messages: [] }
  }

  let version = active
  let outcome = first
  if (first.jumpToFlow) {
    const target = await store.chapter(first.jumpToFlow)
    if (!target) {
      outcome = {
        ...first,
        messages: [...first.messages, missingChapterLine(first.jumpToFlow, environmentLabel)],
        jumpToFlow: undefined,
      }
    } else {
      const jumped = await runVersion(store, {
        machine,
        version: target,
        fsRecord: null,
        conversationId,
        botId,
        tenantId,
        userText,
        contactName: named.spoken,
        seedVariables: copyJumpVariables(first.session.variables, userText, named.spoken),
      })
      if (jumped) {
        version = target
        outcome = { ...jumped, messages: [...first.messages, ...jumped.messages] }
        await logJump(store, first.session, target)
        if (!convo.subject) await store.setSubject(target.flow.name)
      }
    }
  } else if (
    !isSmallTalk(userText)
    && !/^book/i.test(version.flow.name)
    && (!fsRecord?.waitingFor || isTopicSwitch(userText))
  ) {
    const map = await loadChapters()
    const nextName = await hearChapter({ chapters: map, catalog, text: userText, current: version.flow.name }, llmAdapter)
    const target = nextName
      ? await store.chapter(nextName)
      : null
    if (target) {
      const jumped = await runVersion(store, {
        machine,
        version: target,
        fsRecord: null,
        conversationId,
        botId,
        tenantId,
        userText,
        contactName: named.spoken,
        seedVariables: copyJumpVariables(first.session.variables, userText, named.spoken),
      })
      if (jumped) {
        version = target
        outcome = { ...jumped, messages: jumped.messages }
        await logJump(store, first.session, target)
        if (!convo.subject) await store.setSubject(target.flow.name)
      }
    }
  }

  const asked = outcome.session.waitingFor?.question ?? questionFrom(outcome.messages.at(-1) ?? '')
  const aiTurn = outcome.session.waitingFor?.type === 'ai'
  if (!first.jumpToFlow && asked && !aiTurn && outcome.session.waitingFor?.variable !== 'preferred_time' && sameQuestion(asked, previousAsked)) {
    const retried = await runVersion(store, {
      machine,
      version,
      fsRecord: null,
      conversationId,
      botId,
      tenantId,
      userText,
      contactName: named.spoken,
      seedVariables: copyJumpVariables(outcome.session.variables, userText, named.spoken),
    })
    const retryAsked = retried
      ? (retried.session.waitingFor?.question ?? questionFrom(retried.messages.at(-1) ?? ''))
      : undefined
    if (retried && retried.messages.some((line) => line.trim()) && !sameQuestion(retryAsked, asked)) {
      outcome = retried
    } else {
      const map = await loadChapters()
      outcome = { ...outcome, messages: [offerOnMap(map, version.flow.name)] }
    }
  }

  const shaped = shapeTurn(keepFirstQuestion(outcome.messages.filter((line) => line.trim()).join('\n\n')), version.flow.name)
  if (shaped) outcome = { ...outcome, messages: [shaped] }

  const visible = outcome.messages.some((message) => message.trim().length > 0)
  if (visible) {
    const finished = finishBotLines(outcome.messages, named.contact, named.spoken, {
      waiting: outcome.session.status === 'waiting_input',
      conversationId,
    })
    outcome = { ...outcome, messages: finished.lines }
    if (named.contact?.id && finished.metadata) {
      await store.saveContactName(named.contact.id, { metadata: finished.metadata }).catch(() => {})
    }
  }
  if (!visible && !outcome.handover) {
    const map = await loadChapters()
    const offer = silentMapReply(map, version.flow.name)
    if (!offer) {
      await store.clearSession()
      return { handled: false, messages: [] }
    }
    outcome = { ...outcome, messages: [offer] }
  }

  await store.saveSession({
    id: outcome.session.id,
    flowId: version.flowId,
    flowVersionId: version.id,
    currentNodeId: outcome.session.currentNodeId,
    variables: outcome.session.variables,
    status: outcome.session.status,
    waitingFor: outcome.session.waitingFor,
  })

  if (!outcome.handover && outcome.session.status === 'completed') {
    await store.resolved()
  }
  if (outcome.ticket) {
    await store.createTicket({
      subject: outcome.ticket.subject.slice(0, 180),
      description: (outcome.ticket.description ?? outcome.ticket.subject).slice(0, 2000),
    })
  }

  const messages = named.thanks && !outcome.messages.includes(named.thanks)
    ? [named.thanks, ...outcome.messages]
    : outcome.messages
  return {
    handled: true,
    messages,
    handover: outcome.handover,
    ticket: outcome.ticket,
    waitingFor: outcome.session.waitingFor,
    ended: outcome.session.status === 'completed',
    flowName: version.flow.name,
  }
}

async function entryVersion(botId: string): Promise<VersionRow | undefined> {
  const versions = await prisma.flowVersion.findMany({
    where: { flow: { botId } },
    include: { flow: true },
  })
  return pickWorkingCopy(versions)
}

/** The bot's saved journey: the newest graph per chapter, and the welcome it opens on. */
export async function savedJourney(botId: string): Promise<{ chapters: Array<{ name: string; graph: FlowGraph }>; entry?: string }> {
  const versions = await prisma.flowVersion.findMany({
    where: { flow: { botId } },
    include: { flow: true },
  })
  return {
    chapters: newestByFlow(versions).map((row) => ({ name: row.flow.name, graph: row.graph as unknown as FlowGraph })),
    entry: pickWorkingCopy(versions)?.flow.name,
  }
}

async function chaptersForBot(botId: string): Promise<Array<{ name: string; graph: FlowGraph }>> {
  const versions = await prisma.flowVersion.findMany({
    where: { flow: { botId } },
    include: { flow: true },
  })
  return newestByFlow(versions).map((row) => ({
    name: row.flow.name,
    graph: row.graph as unknown as FlowGraph,
  }))
}

async function logJump(store: JourneyStore, from: Session, target: VersionRow): Promise<void> {
  const jump = {
    nodeId: 'jump',
    nodeKind: 'execute_flow',
    input: { fromFlowId: from.flowId, toFlowId: target.flowId, toName: target.flow.name },
    output: { toFlowId: target.flowId },
  }
  await store.logStep({ ...jump, flowVersionId: from.flowVersionId })
  await store.logStep({ ...jump, flowVersionId: target.id })
}

async function runVersion(store: JourneyStore, opts: {
  machine: SessionMachine
  version: VersionRow
  fsRecord: SavedSession | null
  conversationId: string
  botId: string
  tenantId: string
  userText: string
  contactName: string
  seedVariables?: SessionVariables
}) {
  const graph = opts.version.graph as unknown as FlowGraph
  const startId = startNodeId(graph)
  if (!startId) return null

  let session: Session
  if (!opts.fsRecord) {
    session = {
      id: randomUUID(),
      conversationId: opts.conversationId,
      botId: opts.botId,
      tenantId: opts.tenantId,
      flowId: opts.version.flowId,
      flowVersionId: opts.version.id,
      currentNodeId: startId,
      variables: opts.seedVariables ?? {
        flow: { _last_user_message: opts.userText },
        global: {},
        contact: { name: opts.contactName },
      } satisfies SessionVariables,
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  } else {
    const saved = opts.fsRecord
    const onGraph = graph.nodes.some((node) => node.id === saved.currentNodeId)
    session = {
      id: saved.id,
      conversationId: opts.conversationId,
      botId: saved.botId,
      tenantId: saved.tenantId,
      flowId: saved.flowId,
      flowVersionId: saved.flowVersionId,
      currentNodeId: onGraph ? saved.currentNodeId : startId,
      variables: resumeVariables(saved.variables, opts.userText, opts.contactName),
      status: onGraph ? saved.status as Session['status'] : 'running',
      waitingFor: onGraph ? saved.waitingFor as Session['waitingFor'] | undefined : undefined,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    }
  }

  const result = await runFlowTurn(opts.machine, session, graph, startId, opts.userText)
  if (!opts.fsRecord) {
    await store.logStep({ flowVersionId: opts.version.id, nodeId: startId, nodeKind: 'trigger_start' })
  }
  return {
    session: result.session,
    messages: result.newMessages.map((message) => message.content.text),
    handover: result.handover,
    jumpToFlow: result.jumpToFlow,
    ticket: result.ticket,
  }
}

/** Live chats: flow_sessions, step_logs and tickets in Postgres. */
export function postgresJourneyStore(opts: { conversationId: string; botId: string; tenantId: string }): JourneyStore {
  const { conversationId, botId, tenantId } = opts
  return {
    async chat() {
      const convo = await prisma.conversation.findFirst({
        where: { id: conversationId },
        select: { environmentId: true, subject: true, environment: { select: { kind: true } } },
      })
      if (!convo?.environmentId) return null
      return { environmentLabel: convo.environment?.kind === 'production' ? 'Production' : 'Sandbox', subject: convo.subject }
    },
    nameTurn: (userText) => takeNameTurn(conversationId, userText),
    saveContactName,
    loadSession: () => prisma.flowSession.findUnique({ where: { conversationId } }),
    async saveSession(session) {
      const row = {
        flowId: session.flowId,
        flowVersionId: session.flowVersionId,
        currentNodeId: session.currentNodeId,
        variables: session.variables as object,
        status: session.status,
        waitingFor: session.waitingFor ? (session.waitingFor as object) : undefined,
      }
      await prisma.flowSession.upsert({
        where: { conversationId },
        create: { id: session.id, tenantId, conversationId, botId, ...row },
        update: row,
      })
    },
    async clearSession() {
      await prisma.flowSession.delete({ where: { conversationId } }).catch(() => {})
    },
    entry: () => entryVersion(botId),
    version: (id) => prisma.flowVersion.findUnique({ where: { id }, include: { flow: true } }),
    chapter: (name) => prisma.flowVersion.findFirst({
      where: { flow: { botId, name } },
      include: { flow: true },
      orderBy: { version: 'desc' },
    }),
    chapters: () => chaptersForBot(botId),
    llm: () => botLlm(botId),
    catalog: () => botCatalog(botId, tenantId),
    db: () => prisma,
    reopen: () => reopenForBot(conversationId),
    async resolved() {
      await resolveByBot(conversationId)
    },
    async setSubject(subject) {
      await prisma.conversation.update({ where: { id: conversationId }, data: { subject } }).catch(() => {})
    },
    async logStep(row) {
      await prisma.stepLog.create({ data: { tenantId, conversationId, ...row } }).catch(() => {})
    },
    async createTicket(ticket) {
      await prisma.ticket.create({
        data: { tenantId, conversationId, ...ticket, status: 'open', priority: 'medium' },
      }).catch(() => {})
    },
  }
}

/** The bot's own model, as live chats use it. */
export async function botLlm(botId: string): Promise<JourneyLlm> {
  const cfg = await prisma.botConfig.findUnique({ where: { botId } }).catch(() => null)
  const model = cfg?.model ?? undefined
  return model ? createLlmAdapterForModel(model) : defaultLlm
}

export async function botCatalog(botId: string, tenantId: string): Promise<StudioCatalog | undefined> {
  const row = await prisma.entity.findFirst({ where: { botId, tenantId, name: CATALOG_ENTITY } }).catch(() => null)
  return catalogFromValues(row?.values)
}
