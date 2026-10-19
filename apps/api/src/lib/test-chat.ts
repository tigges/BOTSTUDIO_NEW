/**
 * Journey Test and Test Bot: the live turn pipeline over the working copy.
 *
 * runTurnWith runs every stage a live chat runs (always-human words, opening
 * hours, the journey, the name turn, the knowledge answer) with the bot's own
 * model, handover rules and knowledge. Only storage differs: the chat, its
 * session and its outcome stay in a state object the caller hands back on the
 * next turn, so a test never reaches the Inbox, analytics or the guest list.
 * Model calls are recorded in the ledger as the test environment.
 */

import { prisma } from '@ybot/db'
import { handoverSummary, type HandoverContract, type StudioCatalog } from '@ybot/shared'
import type { FlowGraph, ToolCallResult } from '@ybot/runtime'
import { turnSafety, type TurnSafety } from './guardrails.js'
import { handoverRulesFor, type HandoverRules } from './handover.js'
import { botCatalog, botLlm, runJourney, type JourneyLlm, type JourneyStore, type SavedSession, type VersionRow } from './flow-runner.js'
import { withLlmScope, type LlmSource } from './llm-ledger.js'
import { answerFromKnowledge, runTurnWith, type AnswerRequest, type TurnPorts, type TurnResult } from './turn-pipeline.js'
import { planNameTurn, type VisitorName } from './visitor-name.js'
import type { ChatOutcome } from './chat-outcome.js'
import { findTool } from './tools-store.js'
import { runTool } from './tool-runner.js'

export const TEST_CHAT_ID = 'test-chat'
const TEST_GUEST_ID = 'test-guest'
const TRANSCRIPT_LIMIT = 40

export interface TestChapter {
  name: string
  graph: FlowGraph
}

export interface TestLine {
  role: 'user' | 'assistant'
  content: string
}

/** Everything a test chat remembers between turns. The caller stores it and sends it back. */
export interface TestChatState {
  session: (Omit<SavedSession, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string }) | null
  contactMeta: Record<string, unknown>
  transcript: TestLine[]
  status: 'active' | 'resolved' | 'escalated'
  outcome: ChatOutcome | null
  subject: string | null
  handover: HandoverContract | null
  ticket: { subject: string; description: string } | null
}

export interface TestTurnInput {
  tenantId: string
  botId: string
  chapters: TestChapter[]
  startChapter: string
  environmentLabel: string
  message: string
  opening?: boolean
  catalog?: StudioCatalog
  state?: TestChatState
  onChunk?: (chunk: string) => void
  /** Ledger source for the model calls. Eval runs are recorded as 'eval'. */
  ledgerSource?: LlmSource
}

export interface TestTurn {
  text: string
  path: TurnResult['path']
  ended: boolean
  chapter: string
  state: TestChatState
  /** Tools the journey ran this turn. Tools that change data are skipped, not run. */
  tools: TestToolCall[]
}

export interface TestToolCall {
  toolId: string
  name: string
  ok: boolean
  skipped: boolean
  error?: string
}

/** Swappable for tests. Defaults are what live chats use. */
export interface TestChatDeps {
  handoverRules: (botId: string) => Promise<HandoverRules>
  answer: (request: AnswerRequest) => Promise<void>
  llm: (botId: string) => Promise<JourneyLlm>
  catalog: (botId: string, tenantId: string) => Promise<StudioCatalog | undefined>
  db: unknown
  now: () => Date
  runTool: (tenantId: string, botId: string, toolId: string, args: Record<string, unknown>) => Promise<ToolCallResult & { name: string }>
  /** The bot's active guardrails and privacy settings, the same ones live chats use. */
  safety: (botId: string) => Promise<TurnSafety>
}

async function runTestTool(tenantId: string, botId: string, toolId: string, args: Record<string, unknown>): Promise<ToolCallResult & { name: string }> {
  const tool = await findTool(tenantId, botId, toolId)
  if (!tool) return { name: 'unknown tool', ok: false, output: null, error: 'This tool is no longer in the Tools list.' }
  const result = await runTool(tool, args, { source: 'test_chat' })
  return { name: tool.name, ok: result.ok, output: result.output, error: result.error, skipped: result.skipped }
}

const liveDeps: TestChatDeps = {
  handoverRules: handoverRulesFor,
  answer: answerFromKnowledge,
  llm: botLlm,
  catalog: botCatalog,
  db: prisma,
  now: () => new Date(),
  runTool: runTestTool,
  safety: turnSafety,
}

const calls = new WeakMap<TestChatDeps, TestToolCall[]>()
function toolLog(deps: TestChatDeps): TestToolCall[] {
  let log = calls.get(deps)
  if (!log) { log = []; calls.set(deps, log) }
  return log
}

export function newTestState(): TestChatState {
  return {
    session: null,
    contactMeta: {},
    transcript: [],
    status: 'active',
    outcome: null,
    subject: null,
    handover: null,
    ticket: null,
  }
}

/** Test Bot on the canvas: the chart on screen replaces its saved copy; handoffs reach the other saved chapters. */
export function withWorkingCopy(saved: TestChapter[], name: string, graph: FlowGraph): TestChapter[] {
  return [{ name, graph }, ...saved.filter((chapter) => chapter.name !== name)]
}

function chapterRow(chapter: TestChapter): VersionRow {
  return { id: `test:${chapter.name}`, flowId: `test:${chapter.name}`, graph: chapter.graph, flow: { name: chapter.name, tags: [] } }
}

function guest(state: TestChatState): VisitorName {
  return { id: TEST_GUEST_ID, displayName: null, metadata: state.contactMeta }
}

function remember(state: TestChatState, line: TestLine): void {
  if (!line.content.trim()) return
  state.transcript.push(line)
  if (state.transcript.length > TRANSCRIPT_LIMIT) state.transcript.splice(0, state.transcript.length - TRANSCRIPT_LIMIT)
}

/** A journey only follows a handoff to a chapter that was passed in. */
export function testJourneyStore(input: TestTurnInput, state: TestChatState, deps: TestChatDeps): JourneyStore {
  const rows: VersionRow[] = []
  for (const chapter of input.chapters) {
    if (!rows.some((row) => row.flow.name === chapter.name)) rows.push(chapterRow(chapter))
  }
  let catalog: Promise<StudioCatalog | undefined> | undefined
  return {
    chat: async () => ({ environmentLabel: input.environmentLabel, subject: state.subject }),
    async nameTurn(userText) {
      const plan = planNameTurn(guest(state), userText, TEST_CHAT_ID)
      if (plan.metadata) state.contactMeta = plan.metadata
      return { ...plan, contact: guest(state) }
    },
    async saveContactName(_id, change) {
      if (change.metadata) state.contactMeta = change.metadata
    },
    async loadSession() {
      const saved = state.session
      if (!saved) return null
      return { ...saved, createdAt: new Date(saved.createdAt), updatedAt: new Date(saved.updatedAt) }
    },
    async saveSession(session) {
      const at = deps.now().toISOString()
      state.session = {
        id: session.id,
        botId: input.botId,
        tenantId: input.tenantId,
        flowId: session.flowId,
        flowVersionId: session.flowVersionId,
        currentNodeId: session.currentNodeId,
        variables: session.variables,
        status: session.status,
        waitingFor: session.waitingFor ?? null,
        createdAt: state.session?.createdAt ?? at,
        updatedAt: at,
      }
    },
    async clearSession() {
      state.session = null
    },
    entry: async () => rows.find((row) => row.flow.name === input.startChapter),
    version: async (id) => rows.find((row) => row.id === id) ?? null,
    chapter: async (name) => rows.find((row) => row.flow.name === name) ?? null,
    chapters: async () => rows.map((row) => ({ name: row.flow.name, graph: row.graph as FlowGraph })),
    llm: () => deps.llm(input.botId),
    catalog() {
      catalog ??= input.catalog ? Promise.resolve(input.catalog) : deps.catalog(input.botId, input.tenantId)
      return catalog
    },
    db: () => deps.db,
    now: deps.now,
    async reopen() {
      if (state.status === 'resolved' && state.outcome !== 'escalated') {
        state.status = 'active'
        state.outcome = null
      }
    },
    async resolved() {
      if (state.status !== 'active') return
      state.status = 'resolved'
      if (state.outcome !== 'escalated') state.outcome = 'contained_resolved'
    },
    async setSubject(subject) {
      state.subject = subject
    },
    async logStep() {},
    async runTool(toolId, args) {
      const result = await deps.runTool(input.tenantId, input.botId, toolId, args)
      toolLog(deps).push({ toolId, name: result.name, ok: result.ok, skipped: result.skipped === true, ...(result.error ? { error: result.error } : {}) })
      return result
    },
    async createTicket(ticket) {
      state.ticket = ticket
    },
  }
}

function testPorts(input: TestTurnInput, state: TestChatState, deps: TestChatDeps): TurnPorts {
  const store = testJourneyStore(input, state, deps)
  return {
    safety: deps.safety,
    async saveInbound(turn) {
      remember(state, { role: 'user', content: turn.text })
    },
    held: async () => state.status === 'escalated',
    handoverRules: deps.handoverRules,
    async handOver(_turn, request, source) {
      const guestLines = state.transcript.filter((line) => line.role === 'user').map((line) => line.content)
      state.handover = {
        ...request,
        summary: request.summary || handoverSummary(guestLines, request.variables),
        at: deps.now().toISOString(),
        source,
      }
      state.status = 'escalated'
      state.outcome = 'escalated'
    },
    async noTeam() {
      state.outcome ??= 'contained_unresolved'
    },
    runJourney: (turn) => runJourney(store, {
      conversationId: TEST_CHAT_ID,
      botId: turn.botId,
      tenantId: turn.tenantId,
      userText: turn.text,
    }),
    nameTurn: async (_id, text) => store.nameTurn(text),
    async history(_id, current) {
      const lines = state.transcript.slice()
      if (lines.at(-1)?.role === 'user' && lines.at(-1)?.content === current) lines.pop()
      return lines.slice(-10).map((line) => ({ role: line.role, content: line.content }))
    },
    answer: deps.answer,
    async saveOutbound(_turn, text) {
      remember(state, { role: 'assistant', content: text })
    },
    saveContactName: store.saveContactName,
    warn: (message, err) => console.warn(`[test chat] ${message}:`, err instanceof Error ? err.message : err),
  }
}

function chapterOf(state: TestChatState, fallback: string): string {
  const flowId = state.session?.flowId ?? ''
  return flowId.startsWith('test:') ? flowId.slice('test:'.length) : fallback
}

/** One test turn. The state comes back with the reply; send it with the next message. */
export async function runTestTurn(input: TestTurnInput, overrides: Partial<TestChatDeps> = {}): Promise<TestTurn> {
  const deps = { ...liveDeps, ...overrides }
  const tools: TestToolCall[] = []
  calls.set(deps, tools)
  const state: TestChatState = structuredClone(input.state ?? newTestState())
  const ports = testPorts(input, state, deps)
  const message = input.message.trim()
  const scope = { source: input.ledgerSource ?? 'runtime', tenantId: input.tenantId, botId: input.botId, environment: 'test' }
  const result = await withLlmScope(scope, () => runTurnWith(ports, {
    conversationId: TEST_CHAT_ID,
    tenantId: input.tenantId,
    botId: input.botId,
    text: message,
    opening: input.opening ?? !message,
    onChunk: input.onChunk,
  }))
  return {
    text: result.text,
    path: result.path,
    ended: result.ended,
    chapter: chapterOf(state, input.startChapter),
    state,
    tools,
  }
}
