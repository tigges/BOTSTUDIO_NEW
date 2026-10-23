/**
 * One path for every bot turn: the website widget, messaging channels and the Inbox.
 *
 * Stages, in order:
 *   1. scope    every model call in the turn is attributed to this chat (llm_calls)
 *   2. inbound  check the guest's line against the bot's guardrails, save it,
 *               start the SLA clock, fire message rules
 *   3. held     a person holds the chat: the bot stays quiet
 *   4. guard    a guardrail that blocks, asks again or escalates answers here
 *      human    a word on the always-human list hands over before any journey runs
 *   5. journey  the published journey answers (chapters, jumps, handover, outcome)
 *   6. name     a name the guest just gave is thanked
 *   7. answer   no journey line: answer from the knowledge base with the bot's model
 *   8. outbound check the reply against the guardrails, render personal data for
 *               the guest, save it, stop the SLA clock, tell the Inbox
 *
 * Replies stream as they are written unless a guardrail could change them or the
 * guest sees personal data in another form; then the checked reply is sent whole.
 *
 * A handover (stage 4 or 5) only happens when the bot has opening hours for people.
 * Without them nobody watches the queue, so the bot says so and keeps helping.
 *
 * Sessions live in flow_sessions (Postgres) for every live surface. Journey Test
 * and Test Bot run the same stages with in-memory ports (test-chat.ts).
 */

import { prisma } from '@botstudio/db'
import { createLlmAdapter, createLlmAdapterForModel, type LlmMessage } from '@botstudio/llm'
import {
  alwaysHumanMatch,
  answerLength,
  alwaysHumanRequest,
  BLOCKED_OUTPUT_LINE,
  evaluateGuardrails,
  fillNameTokens,
  guardrailHandoverRequest,
  holdsReplies,
  readerMode,
  type GuardrailHit,
  type HandoverContract,
  type HandoverRequest,
} from '@botstudio/shared'
import { triggerRules } from './automation-engine.js'
import { keepWithBot, markNoTeam } from './chat-outcome.js'
import { runFlowIfPublished, type FlowRunResult } from './flow-runner.js'
import { chatIsHeld, handOverChat, handoverRulesFor, HANDOVER_LINE, type HandoverRules } from './handover.js'
import { knowledgeBlock, searchKnowledgeHits, sourcesOf, type KnowledgeSourceRef } from './knowledge-search.js'
import { turnSafety, type TurnSafety } from './guardrails.js'
import { conversationScope, withLlmScope } from './llm-ledger.js'
import { agentViewFor, presentMessages } from './present-chat.js'
import { renderFor } from './privacy.js'
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
  /** Guardrails the guest's line matched; saved with it. */
  guardrails?: GuardrailHit[]
}

export interface TurnResult {
  text: string
  /** The journey reached its end; a waiting question is still open when false. */
  ended: boolean
  /** held: a person has the chat and the bot said nothing. handover: the bot just passed it on. */
  path: 'journey' | 'name' | 'answer' | 'none' | 'held' | 'handover' | 'guardrail'
  /** The open question's choices, for channels that show them as buttons or a numbered list. */
  choices?: string[]
}

/** A person has the chat, so the guest waits for their reply. */
export function withPerson(result: TurnResult): boolean {
  return result.path === 'held' || result.path === 'handover'
}

export interface AnswerRequest {
  tenantId: string
  botId: string
  text: string
  history: LlmMessage[]
  /** Added to the system prompt, e.g. when a reply is written again after a guardrail. */
  instruction?: string
  onChunk: (chunk: string) => void
}

export interface SavedLineExtra {
  guardrails?: GuardrailHit[]
  /** The knowledge documents the answer was written from. */
  sources?: KnowledgeSourceRef[]
}

export interface AnswerResult {
  sources?: KnowledgeSourceRef[]
}

export interface TurnPorts {
  safety(botId: string): Promise<TurnSafety>
  saveInbound(input: TurnInput): Promise<void>
  held(conversationId: string): Promise<boolean>
  handoverRules(botId: string): Promise<HandoverRules>
  handOver(input: TurnInput, request: HandoverRequest, source: HandoverContract['source']): Promise<void>
  noTeam(conversationId: string): Promise<void>
  runJourney(input: TurnInput): Promise<FlowRunResult>
  nameTurn(conversationId: string, text: string): Promise<NamePlan & { contact: VisitorName | null }>
  history(conversationId: string, current: string): Promise<LlmMessage[]>
  answer(request: AnswerRequest): Promise<AnswerResult | void>
  saveOutbound(input: TurnInput, text: string, extra?: SavedLineExtra): Promise<void>
  saveContactName(contactId: string, change: { metadata?: Record<string, unknown> }): Promise<void>
  warn(message: string, err: unknown): void
}

/** The stage order, with every side effect behind a port. */
export async function runTurnWith(ports: TurnPorts, input: TurnInput): Promise<TurnResult> {
  const emit = (chunk: string) => { if (chunk) input.onChunk?.(chunk) }
  const safety = await ports.safety(input.botId)
  const toGuest = (text: string) => renderFor('end_user', text, safety.privacy, input.tenantId)
  const blockedLine = (hit: GuardrailHit | undefined) =>
    safety.rules.find((rule) => rule.id === hit?.ruleId)?.message.trim() || BLOCKED_OUTPUT_LINE

  const send = async (text: string, result: Omit<TurnResult, 'text'>, hits: GuardrailHit[] = []): Promise<TurnResult> => {
    emit(text)
    await ports.saveOutbound(input, text, hits.length ? { guardrails: hits } : undefined)
    return { text, ...result }
  }

  let rules: HandoverRules | undefined
  const handOver = async (request: HandoverRequest, source: HandoverContract['source'], lines: string[]): Promise<TurnResult> => {
    rules ??= await ports.handoverRules(input.botId)
    const said = lines.filter((line) => line.trim())
    if (!rules.liveAgents) {
      await ports.noTeam(input.conversationId)
      return reply(keepWithBot(said, rules.noTeamLine).join('\n\n'), { ended: false, path: source === 'journey' ? 'journey' : 'none' }, false)
    }
    await ports.handOver(input, request, source)
    return reply(said.length ? said.join('\n\n') : HANDOVER_LINE, { ended: false, path: 'handover' }, false)
  }

  /** Every finished bot line goes through the reply guardrails, then is rendered for the guest. */
  const reply = async (text: string, result: Omit<TurnResult, 'text'>, check = true): Promise<TurnResult> => {
    if (!check) return send(toGuest(text), result)
    const decision = evaluateGuardrails(text, 'output', safety.rules, safety.privacy.custom)
    if (decision.outcome === 'escalate') return handOver(guardrailHandoverRequest(decision.rule!, 'output'), 'guardrail', [])
    if (decision.outcome === 'block' || decision.outcome === 'reask') {
      return send(toGuest(blockedLine(decision.rule)), { ...result, path: 'guardrail' }, decision.hits)
    }
    return send(toGuest(decision.text), result, decision.hits)
  }

  const guard = !input.opening && input.text ? evaluateGuardrails(input.text, 'input', safety.rules, safety.privacy.custom) : null
  if (guard?.hits.length) input = { ...input, text: guard.text, guardrails: guard.hits }

  if (!input.opening && !input.inboundSaved) await ports.saveInbound(input)

  if (await ports.held(input.conversationId)) return { text: '', ended: false, path: 'held' }

  if (guard?.outcome === 'escalate') return handOver(guardrailHandoverRequest(guard.rule!, 'input'), 'guardrail', [])
  if (guard?.outcome === 'block' || guard?.outcome === 'reask') {
    return send(toGuest(guard.line!), { ended: false, path: 'guardrail' })
  }

  if (!input.opening && input.text) {
    rules = await ports.handoverRules(input.botId)
    const word = alwaysHumanMatch(input.text, rules.alwaysHuman)
    if (word) return handOver(alwaysHumanRequest(word), 'always_human', [])
  }

  let steer: FlowRunResult['steer']
  try {
    const journey = await ports.runJourney(input)
    steer = journey.steer
    if (journey.handover) return handOver(journey.handover, 'journey', journey.messages)
    if (journey.handled) {
      const text = journey.messages.filter((line) => line.trim()).join('\n\n')
      const choices = !journey.ended ? journey.waitingFor?.choices?.filter((choice) => choice.trim()) : undefined
      if (text) return reply(text, { ended: Boolean(journey.ended), path: 'journey', ...(choices?.length ? { choices } : {}) })
      return { text: '', ended: Boolean(journey.ended), path: 'journey' }
    }
  } catch (err) {
    ports.warn('journey failed, answering from knowledge', err)
  }

  if (!input.text) return reply(NO_LINE, { ended: false, path: 'none' })

  const named = await ports.nameTurn(input.conversationId, input.text)
  if (named.thanks) return reply(named.thanks, { ended: false, path: 'name' })

  const hold = holdsReplies(safety.rules) || readerMode(safety.privacy, 'end_user') !== 'original'
  let sources: KnowledgeSourceRef[] = []
  const failed = steer?.fallback ?? ANSWER_FAILED
  const answerOnce = async (instruction?: string): Promise<string> => {
    let streamed = ''
    sources = []
    try {
      const history = await ports.history(input.conversationId, input.text)
      const answered = await ports.answer({
        tenantId: input.tenantId,
        botId: input.botId,
        text: input.text,
        history,
        ...(instruction ? { instruction } : {}),
        onChunk: (chunk) => {
          const clean = fillNameTokens(chunk, named.spoken)
          streamed += clean
          if (!hold) emit(clean)
        },
      })
      sources = answered?.sources ?? []
    } catch (err) {
      ports.warn('answer failed', err)
      if (!streamed) {
        if (!hold) emit(failed)
        streamed = failed
      }
    }
    if (!streamed.trim()) {
      if (!hold) emit(failed)
      streamed = failed
    }
    if (streamed === failed) sources = []
    return streamed
  }

  const finish = (streamed: string) => finishBotLines([streamed], named.contact, named.spoken, { conversationId: input.conversationId })
  const streamed = await answerOnce(steer?.instruction)
  let finished = finish(streamed)
  let text = finished.lines.filter((line) => line.trim()).join('\n\n')
  let hits: GuardrailHit[] = []
  let blocked = false

  if (!hold) {
    if (text.startsWith(streamed) && text.length > streamed.length) emit(text.slice(streamed.length))
    hits = evaluateGuardrails(text, 'output', safety.rules, safety.privacy.custom).hits
  } else {
    let decision = evaluateGuardrails(text, 'output', safety.rules, safety.privacy.custom)
    if (decision.outcome === 'reask') {
      const again = await answerOnce([steer?.instruction, `Your previous answer broke the rule "${decision.rule!.name}". Answer again without it.`].filter(Boolean).join('\n\n'))
      finished = finish(again)
      text = finished.lines.filter((line) => line.trim()).join('\n\n')
      const second = evaluateGuardrails(text, 'output', safety.rules, safety.privacy.custom)
      decision = second.outcome === 'reask' ? { ...second, outcome: 'block' } : second
    }
    if (decision.outcome === 'escalate') return handOver(guardrailHandoverRequest(decision.rule!, 'output'), 'guardrail', [])
    hits = decision.hits
    blocked = decision.outcome === 'block'
    text = toGuest(blocked ? blockedLine(decision.rule) : decision.text)
    emit(text)
  }

  if (named.contact?.id && finished.metadata) {
    await ports.saveContactName(named.contact.id, { metadata: finished.metadata }).catch(() => {})
  }
  const cited = blocked ? [] : sources
  const extra: SavedLineExtra = { ...(hits.length ? { guardrails: hits } : {}), ...(cited.length ? { sources: cited } : {}) }
  await ports.saveOutbound(input, text, Object.keys(extra).length ? extra : undefined)
  return { text, ended: false, path: 'answer' }
}

type Broadcast = (tenantId: string, event: object) => void
let broadcast: Broadcast = () => {}

/** The API wires the Inbox socket once at startup. A live update that fails never costs the guest a reply. */
export function setTurnBroadcast(next: Broadcast): void {
  broadcast = (tenantId, event) => {
    try { next(tenantId, event) } catch (err) { console.warn('[turn] inbox broadcast failed:', err instanceof Error ? err.message : err) }
  }
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

/** The bot's model answers from the knowledge base, with its own prompt and response length. */
export async function answerFromKnowledge(request: AnswerRequest): Promise<AnswerResult> {
  const cfg = await prisma.botConfig.findUnique({ where: { botId: request.botId } }).catch(() => null)
  const bot = cfg ? null : await prisma.bot.findUnique({ where: { id: request.botId }, select: { name: true } }).catch(() => null)
  const systemPrompt = cfg?.systemPrompt
    ?? `You are a helpful assistant for ${bot?.name ?? 'this business'}. Answer using the knowledge base context.`
  const model = cfg?.model ?? undefined
  const hits = await searchKnowledgeHits(request.text, request.tenantId, request.botId)
  const adapter = model ? createLlmAdapterForModel(model) : defaultLlm
  const length = answerLength(cfg?.responseLength, cfg?.maxTokens)
  await adapter.stream({
    messages: [...request.history, { role: 'user', content: request.text }],
    systemPrompt: `${systemPrompt}\n\n${length.instruction}` + knowledgeBlock(hits) + (request.instruction ? `\n\n${request.instruction}` : ''),
    model,
    temperature: cfg?.temperature ?? 0.3,
    maxTokens: length.maxTokens,
    onChunk: request.onChunk,
  })
  return { sources: sourcesOf(hits) }
}

function lineContent(text: string, guardrails: GuardrailHit[] | undefined, sources?: KnowledgeSourceRef[]) {
  return {
    text,
    ...(guardrails?.length ? { guardrails: guardrails as object[] } : {}),
    ...(sources?.length ? { sources: sources as unknown as object[] } : {}),
  }
}

async function toInbox(input: TurnInput, saved: { content: unknown } | null): Promise<void> {
  if (!saved) return
  const view = await agentViewFor(input.botId, input.tenantId)
  broadcast(input.tenantId, { event: 'message.created', data: presentMessages([saved], null, view)[0] })
}

const ports: TurnPorts = {
  safety: turnSafety,
  async saveInbound(input) {
    const saved = await prisma.message.create({
      data: { tenantId: input.tenantId, conversationId: input.conversationId, direction: 'inbound', authorKind: 'user', content: lineContent(input.text, input.guardrails) },
    }).catch(() => null)
    await toInbox(input, saved)
    await prisma.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }).catch(() => {})
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
  held: chatIsHeld,
  handoverRules: handoverRulesFor,
  async handOver(input, request, source) {
    await handOverChat({ conversationId: input.conversationId, tenantId: input.tenantId, botId: input.botId, request, source })
  },
  noTeam: markNoTeam,
  runJourney: (input) => runFlowIfPublished({
    conversationId: input.conversationId,
    botId: input.botId,
    tenantId: input.tenantId,
    userText: input.text,
  }),
  nameTurn: takeNameTurn,
  history: chatHistory,
  answer: answerFromKnowledge,
  async saveOutbound(input, text, extra) {
    if (!text.trim()) return
    const saved = await prisma.message.create({
      data: { tenantId: input.tenantId, conversationId: input.conversationId, direction: 'outbound', authorKind: 'bot', content: lineContent(text, extra?.guardrails, extra?.sources) },
    }).catch(() => null)
    await prisma.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }).catch(() => {})
    await onOutboundReply(input.conversationId).catch(() => {})
    await toInbox(input, saved)
  },
  saveContactName,
  warn: (message, err) => console.warn(`[turn] ${message}:`, err instanceof Error ? err.message : err),
}

/** Runs one bot turn for a chat on any surface. */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const scope = await conversationScope(input.conversationId)
  return withLlmScope(scope, () => runTurnWith(ports, input))
}
