/**
 * flow-runner.ts
 *
 * Integrates the @ybot/runtime SessionMachine with the widget public chat route.
 * The newest published welcome flow is the entry. An execute_flow node jumps
 * into another published flow in the same environment. Session state is stored
 * in flow_sessions so a later message resumes the flow the visitor is in.
 */

import { randomUUID } from 'node:crypto'
import { SessionMachine } from '@ybot/runtime'
import type { Session, SessionVariables, FlowGraph } from '@ybot/runtime'
import { prisma } from '@ybot/db'
import { createLlmAdapter, createLlmAdapterForModel } from '@ybot/llm'
import { pickEntry } from './entry-flow.js'
import { runFlowTurn } from './flow-turn.js'
import { finishBotLines, nameThanksEndsTurn, saveContactName, takeNameTurn } from './visitor-name.js'

const defaultLlm = createLlmAdapter({
  provider: (process.env['LLM_PROVIDER'] as 'openai' | 'anthropic' | 'groq' | 'ollama' | 'gemini') ?? 'openai',
  apiKey: process.env['LLM_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '',
  model: process.env['LLM_MODEL'],
  baseUrl: process.env['LLM_BASE_URL'],
})

export interface FlowRunResult {
  handled: boolean
  messages: string[]
  handover?: { team?: string; priority?: string; note?: string }
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
    select: { environmentId: true, subject: true },
  })
  const envId = convo?.environmentId
  if (!envId) return { handled: false, messages: [] }

  let fsRecord = await prisma.flowSession.findUnique({ where: { conversationId } })
  let active = fsRecord
    ? await prisma.flowVersion.findUnique({ where: { id: fsRecord.flowVersionId }, include: { flow: true } })
    : await entryVersion(botId, envId)
  if (!active) return { handled: false, messages: [] }

  const cfg = await prisma.botConfig.findUnique({ where: { botId } }).catch(() => null)
  const model = cfg?.model ?? undefined
  const llmAdapter = model ? createLlmAdapterForModel(model) : defaultLlm
  const machine = new SessionMachine({ llm: llmAdapter, db: prisma, httpFetch: fetch })

  let first
  try {
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
  } catch (error) {
    if (!fsRecord) throw error
    await prisma.flowSession.delete({ where: { conversationId } }).catch(() => {})
    const entry = await entryVersion(botId, envId)
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
  if (!first) return { handled: false, messages: [] }

  let version = active
  let outcome = first
  if (first.jumpToFlow) {
    const target = await prisma.flowVersion.findFirst({
      where: { status: 'published', environmentId: envId, flow: { botId, name: first.jumpToFlow } },
      include: { flow: true },
      orderBy: { publishedAt: 'desc' },
    })
    if (!target) {
      outcome = {
        ...first,
        messages: [...first.messages, `I can help with ${first.jumpToFlow}. A person on the team will follow up.`],
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
      })
      if (jumped) {
        version = target
        outcome = { ...jumped, messages: [...first.messages, ...jumped.messages] }
        if (!convo?.subject) {
          await prisma.conversation.update({ where: { id: conversationId }, data: { subject: target.flow.name } }).catch(() => {})
        }
      }
    }
  }

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
    await prisma.flowSession.delete({ where: { conversationId } }).catch(() => {})
    return { handled: false, messages: [] }
  }

  if (outcome.session.status === 'completed') {
    await prisma.flowSession.delete({ where: { conversationId } }).catch(() => {})
  } else {
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
  }

  if (outcome.handover) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'waiting_agent' } }).catch(() => {})
  }

  const messages = named.thanks && !outcome.messages.includes(named.thanks)
    ? [named.thanks, ...outcome.messages]
    : outcome.messages
  return {
    handled: true,
    messages,
    handover: outcome.handover,
    waitingFor: outcome.session.waitingFor,
    ended: outcome.session.status === 'completed',
    flowName: version.flow.name,
  }
}

async function entryVersion(botId: string, environmentId: string) {
  const versions = await prisma.flowVersion.findMany({
    where: { status: 'published', environmentId, flow: { botId } },
    include: { flow: true },
  })
  return pickEntry(versions)
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
      variables: {
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
  }
}
