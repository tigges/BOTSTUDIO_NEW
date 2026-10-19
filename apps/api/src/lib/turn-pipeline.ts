/**
 * One path for every bot turn: the website widget, messaging channels and the Inbox.
 *
 * Stages, in order:
 *   1. scope    every model call in the turn is attributed to this chat (llm_calls)
 *   2. inbound  save the guest's line, start the SLA clock, fire message rules
 *   3. journey  the published journey answers (chapters, jumps, handover, outcome)
 *   4. name     a name the guest just gave is thanked
 *   5. answer   no journey line: answer from the knowledge base with the bot's model
 *   6. outbound save the reply, stop the SLA clock, tell the Inbox
 *
 * Sessions live in flow_sessions (Postgres) for every surface.
 */

import { prisma } from '@ybot/db'
import { createLlmAdapter, createLlmAdapterForModel, type LlmMessage } from '@ybot/llm'
import { fillNameTokens } from '@ybot/shared'
import { triggerRules } from './automation-engine.js'
import { runFlowIfPublished, type FlowRunResult } from './flow-runner.js'
import { knowledgeBlock, searchKnowledge } from './knowledge-search.js'
import { conversationScope, withLlmScope } from './llm-ledger.js'
import { onInboundCustomerMessage, onOutboundReply } from './sla.js'
import { finishBotLines, saveContactName, takeNameTurn, type NamePlan, type VisitorName } from './visitor-name.js'

export const NO_LINE = 'I don’t have a next line for that.'
export const ANSWER_FAILED = "I'm sorry, something went wrong. Please try again."

export interface TurnInput {
  conversationId: string
  tenantId: string
  botId: string
  text: string
  /** The widget opened: the bot speaks first and there is no guest line to save. */
  opening?: boolean
  /** The caller already saved the guest's line (the Inbox posts it itself). */
  inboundSaved?: boolean
  /** Streams reply text as it is produced. Joined chunks always equal the returned text. */
  onChunk?: (chunk: string) => void
}

export interface TurnResult {
  text: string
  /** The journey reached its end; a waiting question is still open when false. */
  ended: boolean
  path: 'journey' | 'name' | 'answer' | 'none'
}

export interface AnswerRequest {
  tenantId: string
  botId: string
  text: string
  history: LlmMessage[]
  onChunk: (chunk: string) => void
}

export interface TurnPorts {
  saveInbound(input: TurnInput): Promise<void>
  runJourney(input: TurnInput): Promise<FlowRunResult>
  nameTurn(conversationId: string, text: string): Promise<NamePlan & { contact: VisitorName | null }>
  history(conversationId: string, current: string): Promise<LlmMessage[]>
  answer(request: AnswerRequest): Promise<void>
  saveOutbound(input: TurnInput, text: string): Promise<void>
  saveContactName(contactId: string, change: { metadata?: Record<string, unknown> }): Promise<void>
  warn(message: string, err: unknown): void
}

/** The stage order, with every side effect behind a port. */
export async function runTurnWith(ports: TurnPorts, input: TurnInput): Promise<TurnResult> {
  const emit = (chunk: string) => { if (chunk) input.onChunk?.(chunk) }
  const reply = async (text: string, result: Omit<TurnResult, 'text'>): Promise<TurnResult> => {
    emit(text)
    await ports.saveOutbound(input, text)
    return { text, ...result }
  }

  if (!input.opening && !input.inboundSaved) await ports.saveInbound(input)

  try {
    const journey = await ports.runJourney(input)
    if (journey.handled) {
      const text = journey.messages.filter((line) => line.trim()).join('\n\n')
      if (text) return reply(text, { ended: Boolean(journey.ended), path: 'journey' })
      return { text: '', ended: Boolean(journey.ended), path: 'journey' }
    }
  } catch (err) {
    ports.warn('journey failed, answering from knowledge', err)
  }

  if (!input.text) return reply(NO_LINE, { ended: false, path: 'none' })

  const named = await ports.nameTurn(input.conversationId, input.text)
  if (named.thanks) return reply(named.thanks, { ended: false, path: 'name' })

  let streamed = ''
  try {
    const history = await ports.history(input.conversationId, input.text)
    await ports.answer({
      tenantId: input.tenantId,
      botId: input.botId,
      text: input.text,
      history,
      onChunk: (chunk) => {
        const clean = fillNameTokens(chunk, named.spoken)
        streamed += clean
        emit(clean)
      },
    })
  } catch (err) {
    ports.warn('answer failed', err)
    if (!streamed) {
      emit(ANSWER_FAILED)
      streamed = ANSWER_FAILED
    }
  }
  if (!streamed.trim()) {
    emit(ANSWER_FAILED)
    streamed = ANSWER_FAILED
  }

  const finished = finishBotLines([streamed], named.contact, named.spoken, { conversationId: input.conversationId })
  const text = finished.lines.filter((line) => line.trim()).join('\n\n')
  if (text.startsWith(streamed) && text.length > streamed.length) emit(text.slice(streamed.length))
  if (named.contact?.id && finished.metadata) {
    await ports.saveContactName(named.contact.id, { metadata: finished.metadata }).catch(() => {})
  }
  await ports.saveOutbound(input, text)
  return { text, ended: false, path: 'answer' }
}

type Broadcast = (tenantId: string, event: object) => void
let broadcast: Broadcast = () => {}

/** The API wires the Inbox socket once at startup. */
export function setTurnBroadcast(next: Broadcast): void {
  broadcast = next
}

const defaultLlm = createLlmAdapter()

function lineText(content: unknown): { text: string; internal: boolean } {
  const row = content && typeof content === 'object' ? content as { text?: unknown; internal?: unknown } : {}
  return { text: typeof row.text === 'string' ? row.text : '', internal: row.internal === true }
}

/** The last guest and bot lines before this turn, oldest first. Internal notes never reach the model. */
export async function chatHistory(conversationId: string, current: string, limit = 10): Promise<LlmMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit * 2 + 1,
    select: { direction: true, content: true },
  }).catch(() => [])
  const lines = rows
    .map((row) => ({ role: (row.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant', ...lineText(row.content) }))
    .filter((line) => !line.internal && line.text.trim())
  if (lines[0]?.role === 'user' && lines[0].text === current) lines.shift()
  return lines.reverse().slice(-limit).map(({ role, text }) => ({ role, content: text }))
}

const ports: TurnPorts = {
  async saveInbound(input) {
    const saved = await prisma.message.create({
      data: { tenantId: input.tenantId, conversationId: input.conversationId, direction: 'inbound', authorKind: 'user', content: { text: input.text } },
    }).catch(() => null)
    if (saved) broadcast(input.tenantId, { event: 'message.created', data: saved })
    await onInboundCustomerMessage({ conversationId: input.conversationId, botId: input.botId }).catch(() => null)
    const count = await prisma.message.count({ where: { conversationId: input.conversationId, direction: 'inbound' } }).catch(() => 0)
    triggerRules('message.received', {
      tenantId: input.tenantId,
      botId: input.botId,
      conversationId: input.conversationId,
      messageContent: input.text,
      messageCount: count,
      conversationStatus: 'active',
    }).catch(() => {})
  },
  runJourney: (input) => runFlowIfPublished({
    conversationId: input.conversationId,
    botId: input.botId,
    tenantId: input.tenantId,
    userText: input.text,
  }),
  nameTurn: takeNameTurn,
  history: chatHistory,
  async answer(request) {
    const cfg = await prisma.botConfig.findUnique({ where: { botId: request.botId } }).catch(() => null)
    const bot = cfg ? null : await prisma.bot.findUnique({ where: { id: request.botId }, select: { name: true } }).catch(() => null)
    const systemPrompt = cfg?.systemPrompt
      ?? `You are a helpful assistant for ${bot?.name ?? 'this business'}. Answer using the knowledge base context.`
    const model = cfg?.model ?? undefined
    const chunks = await searchKnowledge(request.text, request.tenantId, request.botId)
    const adapter = model ? createLlmAdapterForModel(model) : defaultLlm
    await adapter.stream({
      messages: [...request.history, { role: 'user', content: request.text }],
      systemPrompt: systemPrompt + knowledgeBlock(chunks),
      model,
      temperature: cfg?.temperature ?? 0.3,
      maxTokens: cfg?.maxTokens ?? 2048,
      onChunk: request.onChunk,
    })
  },
  async saveOutbound(input, text) {
    if (!text.trim()) return
    const saved = await prisma.message.create({
      data: { tenantId: input.tenantId, conversationId: input.conversationId, direction: 'outbound', authorKind: 'bot', content: { text } },
    }).catch(() => null)
    await prisma.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }).catch(() => {})
    await onOutboundReply(input.conversationId).catch(() => {})
    if (saved) broadcast(input.tenantId, { event: 'message.created', data: saved })
  },
  saveContactName,
  warn: (message, err) => console.warn(`[turn] ${message}:`, err instanceof Error ? err.message : err),
}

/** Runs one bot turn for a chat on any surface. */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const scope = await conversationScope(input.conversationId)
  return withLlmScope(scope, () => runTurnWith(ports, input))
}
