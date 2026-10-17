/**
 * flow-runner.ts
 *
 * Integrates the @ybot/runtime SessionMachine with the widget public chat route.
 * The newest saved welcome is the entry. An execute_flow node jumps
 * into that chapter's newest saved graph. Session state is stored
 * in flow_sessions so a later message resumes the flow the visitor is in.
 */

import { randomUUID } from 'node:crypto'
import { SessionMachine, copyJumpVariables, missingChapterLine, listenForChapter, chapterRoutes, pickTopic, offerOnMap, isSmallTalk, isTopicSwitch, sameQuestion, questionFrom, keepFirstQuestion, shapeTurn } from '@ybot/runtime'
import type { Session, SessionVariables, FlowGraph } from '@ybot/runtime'
import { prisma } from '@ybot/db'
import { CATALOG_ENTITY, catalogFromValues } from '@ybot/shared'
import { createLlmAdapter, createLlmAdapterForModel } from '@ybot/llm'
import { newestByFlow, pickWorkingCopy } from './entry-flow.js'
import { runFlowTurn } from './flow-turn.js'
import { finishBotLines, nameThanksEndsTurn, saveContactName, takeNameTurn } from './visitor-name.js'

const defaultLlm = createLlmAdapter()

export interface FlowRunResult {
  handled: boolean
  messages: string[]
  handover?: { team?: string; priority?: string; note?: string }
  ticket?: { subject: string; description?: string }
  waitingFor?: Session['waitingFor']
  /** The published flow reached its end. A waiting question is still open. */
  ended?: boolean
  flowName?: string
}

type VersionRow = {
  id: string
  flowId: string
  graph: unknown
  flow: { name: string; tags: string[] }
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

async function hearChapter(
  chapters: Array<{ name: string; graph: FlowGraph }>,
  catalog: Parameters<typeof listenForChapter>[0]['catalog'],
  text: string,
  current: string | undefined,
  llm: unknown,
): Promise<string | undefined> {
  const hit = listenForChapter({ chapters, catalog, text, current })
  if (hit) return hit
  if (isSmallTalk(text)) return undefined
  const routes = chapterRoutes({ chapters, catalog, text, current })
  const picked = await pickTopic(text, routes, llm)
  return picked === 'other' ? undefined : picked
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
  const { conversationId, botId, tenantId, userText } = opts
  const named = await takeNameTurn(conversationId, userText)
  const waiting = named.thanks
    ? await prisma.flowSession.findUnique({ where: { conversationId }, select: { status: true } })
    : null
  if (nameThanksEndsTurn(named.thanks, waiting?.status)) {
    return { handled: true, messages: [named.thanks!] }
  }

  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId },
    select: { environmentId: true, subject: true, environment: { select: { kind: true } } },
  })
  const envId = convo?.environmentId
  if (!envId) return { handled: false, messages: [] }
  const environmentLabel = convo?.environment?.kind === 'production' ? 'Production' : 'Sandbox'

  let fsRecord = await prisma.flowSession.findUnique({ where: { conversationId } })
  let active = fsRecord
    ? await prisma.flowVersion.findUnique({ where: { id: fsRecord.flowVersionId }, include: { flow: true } })
    : await entryVersion(botId)
  if (!active) return { handled: false, messages: [] }

  const cfg = await prisma.botConfig.findUnique({ where: { botId } }).catch(() => null)
  const model = cfg?.model ?? undefined
  const llmAdapter = model ? createLlmAdapterForModel(model) : defaultLlm
  const catalogRow = await prisma.entity.findFirst({ where: { botId, tenantId, name: CATALOG_ENTITY } }).catch(() => null)
  const catalog = catalogFromValues(catalogRow?.values)
  const machine = new SessionMachine({ llm: llmAdapter, db: prisma, httpFetch: fetch, catalog })
  const loadChapters = () => chaptersForBot(botId)
  const previousAsked = savedQuestion(fsRecord?.waitingFor)

  let first
  try {
    if (fsRecord && (fsRecord.status === 'completed' || fsRecord.status === 'handed_over')) {
      const map = await loadChapters()
      const nextName = !isSmallTalk(userText)
        ? await hearChapter(map, catalog, userText, active.flow.name, llmAdapter)
        : undefined
      const target = nextName
        ? await prisma.flowVersion.findFirst({
            where: { flow: { botId, name: nextName } },
            include: { flow: true },
            orderBy: { version: 'desc' },
          })
        : null
      if (target) {
        first = await runVersion({
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
    }
    if (!first) {
      first = await runVersion({
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
    await prisma.flowSession.delete({ where: { conversationId } }).catch(() => {})
    const entry = await entryVersion(botId)
    if (!entry) throw error
    fsRecord = null
    active = entry
    first = await runVersion({
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
    const target = await prisma.flowVersion.findFirst({
      where: { flow: { botId, name: first.jumpToFlow } },
      include: { flow: true },
      orderBy: { version: 'desc' },
    })
    if (!target) {
      outcome = {
        ...first,
        messages: [...first.messages, missingChapterLine(first.jumpToFlow, environmentLabel)],
        jumpToFlow: undefined,
      }
    } else {
      const jumped = await runVersion({
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
        const jumpLog = {
          tenantId,
          conversationId,
          nodeId: 'jump',
          nodeKind: 'execute_flow' as const,
          input: { fromFlowId: first.session.flowId, toFlowId: target.flowId, toName: target.flow.name },
          output: { toFlowId: target.flowId },
        }
        await prisma.stepLog.create({ data: { ...jumpLog, flowVersionId: first.session.flowVersionId } }).catch(() => {})
        await prisma.stepLog.create({ data: { ...jumpLog, flowVersionId: target.id } }).catch(() => {})
        if (!convo?.subject) {
          await prisma.conversation.update({ where: { id: conversationId }, data: { subject: target.flow.name } }).catch(() => {})
        }
      }
    }
  } else if (
    !isSmallTalk(userText)
    && !/^book/i.test(version.flow.name)
    && (!fsRecord?.waitingFor || isTopicSwitch(userText))
  ) {
    const map = await loadChapters()
    const nextName = await hearChapter(map, catalog, userText, version.flow.name, llmAdapter)
    const target = nextName
      ? await prisma.flowVersion.findFirst({
          where: { flow: { botId, name: nextName } },
          include: { flow: true },
          orderBy: { version: 'desc' },
        })
      : null
    if (target) {
      const jumped = await runVersion({
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
        const jumpLog = {
          tenantId,
          conversationId,
          nodeId: 'jump',
          nodeKind: 'execute_flow' as const,
          input: { fromFlowId: first.session.flowId, toFlowId: target.flowId, toName: target.flow.name },
          output: { toFlowId: target.flowId },
        }
        await prisma.stepLog.create({ data: { ...jumpLog, flowVersionId: first.session.flowVersionId } }).catch(() => {})
        await prisma.stepLog.create({ data: { ...jumpLog, flowVersionId: target.id } }).catch(() => {})
        if (!convo?.subject) {
          await prisma.conversation.update({ where: { id: conversationId }, data: { subject: target.flow.name } }).catch(() => {})
        }
      }
    }
  }

  const asked = outcome.session.waitingFor?.question ?? questionFrom(outcome.messages.at(-1) ?? '')
  if (!first.jumpToFlow && asked && outcome.session.waitingFor?.variable !== 'preferred_time' && sameQuestion(asked, previousAsked)) {
    const retried = await runVersion({
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
      await saveContactName(named.contact.id, { metadata: finished.metadata }).catch(() => {})
    }
  }
  if (!visible && !outcome.handover) {
    const map = await loadChapters()
    const offer = silentMapReply(map, version.flow.name)
    if (!offer) {
      await prisma.flowSession.delete({ where: { conversationId } }).catch(() => {})
      return { handled: false, messages: [] }
    }
    outcome = { ...outcome, messages: [offer] }
  }

  await prisma.flowSession.upsert({
    where: { conversationId },
    create: {
      id: outcome.session.id,
      tenantId,
      conversationId,
      botId,
      flowId: version.flowId,
      flowVersionId: version.id,
      currentNodeId: outcome.session.currentNodeId,
      variables: outcome.session.variables as object,
      status: outcome.session.status,
      waitingFor: outcome.session.waitingFor ? (outcome.session.waitingFor as object) : undefined,
    },
    update: {
      flowId: version.flowId,
      flowVersionId: version.id,
      currentNodeId: outcome.session.currentNodeId,
      variables: outcome.session.variables as object,
      status: outcome.session.status,
      waitingFor: outcome.session.waitingFor ? (outcome.session.waitingFor as object) : undefined,
    },
  })

  if (outcome.handover) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'escalated' } }).catch(() => {})
  }
  if (outcome.ticket) {
    await prisma.ticket.create({
      data: {
        tenantId,
        conversationId,
        subject: outcome.ticket.subject.slice(0, 180),
        description: (outcome.ticket.description ?? outcome.ticket.subject).slice(0, 2000),
        status: 'open',
        priority: 'medium',
      },
    }).catch(() => {})
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

async function entryVersion(botId: string) {
  const versions = await prisma.flowVersion.findMany({
    where: { flow: { botId } },
    include: { flow: true },
  })
  return pickWorkingCopy(versions)
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

async function runVersion(opts: {
  machine: SessionMachine
  version: VersionRow
  fsRecord: { id: string; botId: string; tenantId: string; flowId: string; flowVersionId: string; currentNodeId: string; variables: unknown; status: string; waitingFor: unknown; createdAt: Date; updatedAt: Date } | null
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
  return {
    session: result.session,
    messages: result.newMessages.map((message) => message.content.text),
    handover: result.handover,
    jumpToFlow: result.jumpToFlow,
    ticket: result.ticket,
  }
}
