/**
 * One scheduled run against a live server, entirely over HTTP: visitors through
 * the public chat, a person through the Inbox API, releases through the release
 * API. Every expectation becomes a check; the server adds its own on finish.
 */

import { ApiError, RunClient, waitFor, type ChatTurn } from './client.js'
import { pick, pickVisitor, planFor, seeded, type GeneratedVisitor, type PersonScript, type Scenario, type Visitor } from './scenarios.js'

export type Target = 'harbour-dental' | 'bella' | 'acme'
export type Kind = 'traffic' | 'release'

export interface RunCheck {
  name: string
  ok: boolean
  detail?: string
  conversationId?: string
  by?: 'runner' | 'server'
}

export interface RunOptions {
  baseUrl: string
  target: Target
  kind: Kind
  email: string
  password: string
  seed?: string
  /** Generated visitors on top of the fixed scenarios. */
  generated?: number
  /** Turns per generated visitor. */
  generatedTurns?: number
  /** Only these fixed scenarios, by id. */
  only?: string[]
  publicGapMs?: number
  /** Fail the run when chats plus simulated visitors cost more than this. */
  maxCostUsd?: number
  log?: (line: string) => void
}

export interface RunReport {
  runId: string
  target: Target
  kind: Kind
  status: 'passed' | 'failed'
  botName: string
  baseUrl: string
  summary: Record<string, unknown>
  checks: RunCheck[]
}

interface StartedRun {
  runId: string
  token: string
  seed: string
  botId: string
  botName: string
  channelId: string
  allowedDomains: string[]
  liveReleaseId: string | null
  harness: { profile: string; toolsMoved: number } | null
}

interface Convo {
  id: string
  status: string
  assignedTo: string | null
  outcome: string | null
  handover?: { source?: string; priority?: string; reason?: string; returned?: { outcome?: string } } | null
  contact?: { id: string } | null
  labels?: Array<{ label?: { name?: string } }>
  tickets?: Array<{ id: string; subject: string }>
  llm?: { costUsd: number | null; calls: number } | null
  messages?: Array<{ authorKind?: string; content?: { text?: string; internal?: boolean } }>
}

const FAILED_REPLY = 'something went wrong'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const lower = (text: string) => text.toLowerCase().replace(/[’']/g, "'")

export async function runTestRun(opts: RunOptions): Promise<RunReport> {
  const log = opts.log ?? (() => {})
  const client = new RunClient(opts.baseUrl, { publicGapMs: opts.publicGapMs })
  const me = await client.login(opts.email, opts.password)
  const plan = planFor(opts.target)
  const started = (await client.json<StartedRun>('POST', '/api/v1/system/test-runs', {
    target: opts.target,
    kind: opts.kind,
    sentinels: plan.sentinels,
    ...(opts.seed ? { seed: opts.seed } : {}),
    baseUrl: opts.baseUrl,
  })).data
  log(`Run ${started.runId}: ${started.botName}, ${opts.kind}, seed ${started.seed}`)
  const origin = started.allowedDomains[0] ? `https://${started.allowedDomains[0]}` : undefined
  const visitorClient = new RunClient(opts.baseUrl, { publicGapMs: opts.publicGapMs, origin })
  const random = seeded(started.seed)
  const checks: RunCheck[] = []
  const conversationIds: string[] = []
  const check = (name: string, ok: boolean, detail?: string, conversationId?: string) => {
    checks.push({ name, ok, ...(detail ? { detail: detail.slice(0, 1900) } : {}), ...(conversationId ? { conversationId } : {}) })
    if (!ok) log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
  const ctx: Ctx = { client, visitorClient, run: started, me, check, conversationIds, log }

  const before = await overview(client, started.botId)
  try {
    if (opts.kind === 'release') {
      await releaseDrill(ctx)
    } else {
      const scenarios = opts.only?.length ? plan.scenarios.filter((s) => opts.only!.includes(s.id)) : plan.scenarios
      const handedOver: string[] = []
      for (const scenario of scenarios) {
        log(`- ${scenario.title}`)
        const visitor = pickVisitor(random)
        const result = await playScenario(ctx, scenario, visitor, plan.inbox).catch((err: unknown) => {
          check(`${scenario.title}: ran to the end`, false, err instanceof Error ? err.message : String(err))
          return undefined
        })
        if (result?.handedOver) handedOver.push(result.conversationId)
      }
      const count = Math.min(opts.generated ?? (plan.generated.length ? 3 : 0), plan.generated.length)
      for (const persona of pick(plan.generated, count, random)) {
        log(`- Generated visitor: ${persona.goal}`)
        await playGenerated(ctx, persona, opts.generatedTurns ?? 5).catch((err: unknown) => {
          check(`Generated visitor (${persona.goal}): ran to the end`, false, err instanceof Error ? err.message : String(err))
        })
      }
      await resentMessage(ctx).catch((err: unknown) => check('A resent message: ran to the end', false, err instanceof Error ? err.message : String(err)))
      await guardrailActions(ctx).catch((err: unknown) => check('Guardrail actions: ran to the end', false, err instanceof Error ? err.message : String(err)))
      await afterTraffic(ctx, before, handedOver)
    }
  } catch (err) {
    check('The run finished without an error', false, err instanceof Error ? err.message : String(err))
  }
  const finished = (await client.json<{ status: 'passed' | 'failed'; summary: Record<string, unknown>; checks: RunCheck[] }>(
    'POST', `/api/v1/system/test-runs/${started.runId}/finish`,
    { checks, summary: { target: opts.target, kind: opts.kind }, conversationIds, ...(opts.maxCostUsd !== undefined ? { maxCostUsd: opts.maxCostUsd } : {}) },
  )).data
  return {
    runId: started.runId,
    target: opts.target,
    kind: opts.kind,
    status: finished.status,
    botName: started.botName,
    baseUrl: opts.baseUrl,
    summary: finished.summary,
    checks: finished.checks,
  }
}

interface Ctx {
  client: RunClient
  visitorClient: RunClient
  run: StartedRun
  me: { userId: string; tenantId: string }
  check: (name: string, ok: boolean, detail?: string, conversationId?: string) => void
  conversationIds: string[]
  log: (line: string) => void
}

interface Overview {
  totalConversations: number
  resolutionRate?: number | null
  escalationRate?: number | null
  botHandledPct?: number | null
  outcomes?: {
    finished?: number
    buckets?: { contained?: number; escalated?: number; abandoned?: number }
    rates?: { contained: number | null; resolvedByBot: number | null; escalated: number | null; abandoned: number | null }
  }
}

async function overview(client: RunClient, botId: string): Promise<Overview | undefined> {
  return client.json<Overview>('GET', `/api/v1/analytics/overview?botId=${encodeURIComponent(botId)}`).then((res) => res.data).catch(() => undefined)
}

async function conversation(client: RunClient, id: string): Promise<Convo> {
  return (await client.json<Convo>('GET', `/api/v1/conversations/${id}`)).data
}

/** Opens the widget and plays the visitor's lines. Stops when a person takes over. */
async function talk(ctx: Ctx, session: string, lines: string[], label: string): Promise<{ conversationId: string; replies: string[]; turns: ChatTurn[] }> {
  const { visitorClient, run, check } = ctx
  const opening = await visitorClient.chat(run.channelId, { sessionId: session, runToken: run.token })
  const conversationId = opening.conversationId
  if (conversationId && !ctx.conversationIds.includes(conversationId)) ctx.conversationIds.push(conversationId)
  check(`${label}: the widget opens with a greeting`, opening.status === 200 && opening.text.trim().length > 0, opening.status === 200 ? undefined : `HTTP ${opening.status}`, conversationId)
  const turns = [opening]
  const replies = [opening.text]
  let failed = 0
  for (const message of lines) {
    if (turns.at(-1)!.live) break
    const turn = await visitorClient.chat(run.channelId, { sessionId: session, conversationId, message, runToken: run.token })
    turns.push(turn)
    replies.push(turn.text)
    if (turn.status !== 200 || (!turn.live && !turn.text.trim()) || lower(turn.text).includes(FAILED_REPLY)) {
      failed++
      check(`${label}: the bot answers "${message}"`, false, turn.status !== 200 ? `HTTP ${turn.status}` : turn.text ? turn.text.slice(0, 200) : 'empty reply', conversationId)
    }
  }
  if (lines.length && !failed) check(`${label}: the bot answered every message`, true, `${lines.length} messages, slowest ${Math.max(...turns.map((t) => t.ms))} ms`, conversationId)
  return { conversationId, replies, turns }
}

async function playScenario(ctx: Ctx, scenario: Scenario, visitor: Visitor, inbox: boolean) {
  const { client, check, run } = ctx
  const label = scenario.title
  const session = scenario.returning ? `test-run-returning-${run.botId}` : `test-run-${run.runId}-${scenario.id}`
  const { conversationId, replies, turns } = await talk(ctx, session, scenario.visitor(visitor), label)
  if (!conversationId) return undefined
  const said = lower(replies.join('\n'))
  const e = scenario.expect
  for (const text of e.says ?? []) check(`${label}: says "${text}"`, said.includes(lower(text)), said.includes(lower(text)) ? undefined : replies.slice(1).join(' | ').slice(0, 600), conversationId)
  for (const text of e.neverSays ?? []) check(`${label}: never says "${text}"`, !said.includes(lower(text)), said.includes(lower(text)) ? replies.slice(1).join(' | ').slice(0, 600) : undefined, conversationId)
  const answered = replies.slice(1).join('\n')
  for (const { what, pattern } of e.mentions ?? []) check(`${label}: mentions ${what}`, pattern.test(answered), pattern.test(answered) ? undefined : answered.slice(0, 600) || 'no reply', conversationId)

  let convo = await conversation(client, conversationId)
  const handedOver = Boolean(convo.handover) || turns.some((t) => t.live)
  if (e.ends) check(`${label}: ${e.ends === 'handed_over' ? 'hands over to a person' : 'the bot finishes it'}`, (e.ends === 'handed_over') === handedOver, `status ${convo.status}`, conversationId)
  if (handedOver) {
    check(`${label}: the Inbox shows the handover`, Boolean(convo.handover), convo.handover ? `${convo.handover.priority}: ${convo.handover.reason}` : 'no handover on the chat', conversationId)
    if (e.source) check(`${label}: handover came from ${e.source}`, convo.handover?.source === e.source, `source ${convo.handover?.source}`, conversationId)
    if (e.priority) check(`${label}: handover priority is ${e.priority}`, convo.handover?.priority === e.priority, `priority ${convo.handover?.priority}`, conversationId)
  }
  if (e.ticket) check(`${label}: a ticket was raised for reception`, (convo.tickets?.length ?? 0) > 0, convo.tickets?.map((t) => t.subject).join('; '), conversationId)
  if (e.usesModel) check(`${label}: the model call is in the ledger and the Inbox cost`, (convo.llm?.calls ?? 0) > 0, convo.llm ? `${convo.llm.calls} calls, $${convo.llm.costUsd ?? 0}` : 'no model calls billed to this chat', conversationId)

  if (scenario.id === 'medical-details') {
    const inbound = (convo.messages ?? []).filter((m) => m.authorKind === 'user').map((m) => m.content?.text ?? '').join(' ')
    check(`${label}: the Inbox copy hides the medical detail`, !lower(inbound).includes('blood thinners'), inbound.slice(0, 200), conversationId)
  }

  if (scenario.returning) await returningChecks(ctx, convo, label)

  if (scenario.person && handedOver && inbox) {
    await personTakesOver(ctx, scenario.person, conversationId, session, visitor, label)
    convo = await conversation(client, conversationId)
  } else if (handedOver && inbox) {
    check(`${label}: waits unassigned in the queue`, !convo.assignedTo && convo.status !== 'resolved', `status ${convo.status}`, conversationId)
  }

  if (scenario.csat) {
    await ctx.visitorClient.csat(run.channelId, conversationId, scenario.csat, scenario.csat < 0 ? 'I wanted a price for whitening in the surgery.' : undefined)
    if (scenario.csat < 0 && inbox) {
      const labelled = await waitFor(async () => {
        const row = await conversation(client, conversationId)
        return row.labels?.some((l) => l.label?.name === 'Follow up') ? true : undefined
      }, { timeoutMs: 20_000 })
      check(`${label}: the thumbs-down workflow labels it "Follow up"`, Boolean(labelled), labelled ? undefined : 'no "Follow up" label after 20 s', conversationId)
    }
  }
  return { conversationId, handedOver }
}

async function returningChecks(ctx: Ctx, convo: Convo, label: string) {
  const { client, check, run } = ctx
  if (!convo.contact?.id) return check(`${label}: the chat has a contact`, false, undefined, convo.id)
  const earlier = (await client.json<Array<{ id: string }>>('GET', `/api/v1/conversations?botId=${run.botId}&contactId=${convo.contact.id}&limit=50`)).data
  check(`${label}: comes back as the same contact`, earlier.length >= 1, earlier.length > 1 ? `${earlier.length} chats on this contact` : 'first visit on this database', convo.id)
  type Memory = { settings: { enabled: boolean; keys: string[] } }
  const off: Memory = { settings: { enabled: false, keys: [] } }
  const memory = (await client.json<Memory>('GET', `/api/v1/bots/${run.botId}/memory`).catch(() => ({ data: off }))).data
  if (!memory.settings.enabled || !memory.settings.keys.includes('guest_name')) return
  const facts = await waitFor(async () => {
    const rows = (await client.json<Array<{ key: string }>>('GET', `/api/v1/contacts/${convo.contact!.id}/memory`)).data
    return rows.some((row) => row.key === 'guest_name') ? rows : undefined
  }, { timeoutMs: 10_000 })
  check(`${label}: the bot remembers the patient's name`, Boolean(facts), facts ? facts.map((f) => f.key).join(', ') : 'no guest_name in contact memory', convo.id)
}

function fill(value: unknown, slots: string[], visitor: Visitor): unknown {
  if (value === '$firstSlot') return slots[0] ?? 'S-0000-0000'
  if (value === '{visitor}') return `${visitor.first} ${visitor.last}`
  if (value === '{phone}') return visitor.phone
  return value
}

async function personTakesOver(ctx: Ctx, script: PersonScript, conversationId: string, session: string, visitor: Visitor, label: string) {
  const { client, check, run, me } = ctx
  if (script.claim) {
    await client.json('PATCH', `/api/v1/conversations/${conversationId}`, { assignedTo: me.userId })
    const row = await conversation(client, conversationId)
    check(`${label}: the person claims the chat`, row.assignedTo === me.userId, undefined, conversationId)
  }

  if (script.tools?.length) {
    const tools = (await client.json<Array<{ id: string; name: string; effect: string }>>('GET', `/api/v1/conversations/${conversationId}/tools`)).data
    const slots: string[] = []
    for (const step of script.tools) {
      const tool = tools.find((t) => t.name === step.tool)
      if (!tool) {
        check(`${label}: the Inbox lists the tool "${step.tool}"`, false, `Tools: ${tools.map((t) => t.name).join(', ')}`, conversationId)
        continue
      }
      const args = Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key, fill(value, slots, visitor)]))
      const res = await client.json<{ ok: boolean; output?: unknown; error?: string }>(
        'POST', `/api/v1/conversations/${conversationId}/tools/${tool.id}/run`, { args, confirmed: tool.effect !== 'read' },
      )
      const out = res.data
      if (Array.isArray(out.output)) for (const slot of out.output) if (slot && typeof slot === 'object' && 'slot_id' in slot) slots.push(String((slot as { slot_id: unknown }).slot_id))
      const shown = out.ok ? JSON.stringify(out.output ?? null).slice(0, 200) : out.error
      const ok = step.expect === 'error' ? !out.ok
        : step.expect === 'empty' ? out.ok && Array.isArray(out.output) && out.output.length === 0
          : step.expect === 'sources' ? out.ok && passagesWithSources(out.output)
            : out.ok && out.output !== undefined
      const outcome = { error: 'refused', empty: 'no slots', sources: 'passages with their sources', ok: 'answers' }[step.expect]
      check(`${label}: the person runs "${step.tool}" (${outcome})`, ok, shown, conversationId)
    }
  }

  for (const text of script.replies) {
    const sent = await client.json<{ delivery?: string }>('POST', `/api/v1/conversations/${conversationId}/messages`, { content: { text } })
    const seen = await waitFor(async () => {
      const got = await ctx.visitorClient.replies(run.channelId, conversationId, session)
      return got.replies.some((reply) => reply.text === text) ? true : undefined
    }, { timeoutMs: 15_000, everyMs: 3_000 })
    check(`${label}: the visitor sees the person's reply in the widget`, Boolean(seen), `delivery ${sent.data.delivery ?? 'none'}`, conversationId)
  }

  for (const text of script.visitorReplies ?? []) {
    const turn = await ctx.visitorClient.chat(run.channelId, { sessionId: session, conversationId, message: text, runToken: run.token })
    check(`${label}: the bot stays quiet while a person has the chat`, turn.live && !turn.text.trim(), turn.text.slice(0, 200) || undefined, conversationId)
    const messages = (await client.json<Array<{ text?: string; content?: { text?: string } }>>('GET', `/api/v1/conversations/${conversationId}/messages`)).data
    check(`${label}: the person sees the visitor's answer in the Inbox`, messages.some((m) => (m.text ?? m.content?.text ?? '').includes(text.slice(0, 20))), undefined, conversationId)
  }

  if (!script.returnAs) return
  await client.json('POST', `/api/v1/conversations/${conversationId}/return`, { outcome: script.returnAs, ...(script.note ? { note: script.note } : {}) })
  const row = await conversation(client, conversationId)
  check(`${label}: handed back as ${script.returnAs}`, row.handover?.returned?.outcome === script.returnAs, `status ${row.status}`, conversationId)
  if (script.returnAs === 'needs_follow_up') check(`${label}: a follow-up ticket was raised`, (row.tickets ?? []).some((t) => t.subject.startsWith('Follow up')), row.tickets?.map((t) => t.subject).join('; '), conversationId)
  if (script.returnAs === 'resolved') check(`${label}: the chat is resolved`, row.status === 'resolved', `status ${row.status}`, conversationId)
  if (script.returnAs === 'needs_bot' && script.thenVisitor?.length) {
    const replies: string[] = []
    for (const message of script.thenVisitor) {
      const turn = await ctx.visitorClient.chat(run.channelId, { sessionId: session, conversationId, message, runToken: run.token })
      replies.push(turn.text)
      check(`${label}: the bot answers again after the hand-back`, !turn.live && turn.text.trim().length > 0, turn.text.slice(0, 200), conversationId)
    }
    for (const text of script.thenSays ?? []) check(`${label}: after the hand-back the bot says "${text}"`, lower(replies.join(' ')).includes(lower(text)), undefined, conversationId)
  }
}

/** A Knowledge tool answer: at least one passage, each naming its document. */
export function passagesWithSources(output: unknown): boolean {
  const chunks = output && typeof output === 'object' ? (output as { chunks?: unknown }).chunks : undefined
  return Array.isArray(chunks) && chunks.length > 0 && chunks.every((chunk) => {
    const row = chunk && typeof chunk === 'object' ? chunk as Record<string, unknown> : {}
    return typeof row['text'] === 'string' && typeof row['title'] === 'string' && Boolean(row['title']) && typeof row['source'] === 'string'
  })
}

async function playGenerated(ctx: Ctx, persona: GeneratedVisitor, maxTurns: number) {
  const { visitorClient, client, run, check } = ctx
  const label = `Generated visitor (${persona.goal})`
  const session = `test-run-${run.runId}-gen-${ctx.conversationIds.length}`
  const opening = await visitorClient.chat(run.channelId, { sessionId: session, runToken: run.token })
  const conversationId = opening.conversationId
  if (conversationId) ctx.conversationIds.push(conversationId)
  check(`${label}: the widget opens with a greeting`, opening.status === 200 && opening.text.trim().length > 0, undefined, conversationId)
  const transcript: Array<{ from: 'visitor' | 'bot' | 'person'; text: string }> = [{ from: 'bot', text: opening.text }]
  let failures = 0
  let turns = 0
  for (; turns < maxTurns; turns++) {
    const next = await client.json<{ text: string; done: boolean }>('POST', `/api/v1/system/test-runs/${run.runId}/visitor`, { persona: persona.persona, goal: persona.goal, transcript }, { allow: [503] })
    if (next.status === 503) {
      check(`${label}: a model is available to play the visitor`, true, 'skipped: no cloud model on the server')
      return
    }
    if (next.data.done || !next.data.text) break
    transcript.push({ from: 'visitor', text: next.data.text })
    const turn = await visitorClient.chat(run.channelId, { sessionId: session, conversationId, message: next.data.text, runToken: run.token })
    if (turn.status !== 200 || (!turn.live && !turn.text.trim()) || lower(turn.text).includes(FAILED_REPLY)) {
      failures++
      check(`${label}: the bot answers "${next.data.text}"`, false, turn.status !== 200 ? `HTTP ${turn.status}` : turn.text.slice(0, 200) || 'empty reply', conversationId)
    }
    if (turn.live) break
    transcript.push({ from: 'bot', text: turn.text })
  }
  if (!failures) check(`${label}: the bot answered every message`, true, `${turns} messages`, conversationId)
}

/** The widget resends the same message id, as a browser retry or a provider webhook retry would. */
async function resentMessage(ctx: Ctx) {
  const { visitorClient, client, run, check } = ctx
  const label = 'A resent message'
  const session = `test-run-${run.runId}-resent`
  const text = 'What are your opening hours?'
  const messageId = `${run.runId}-resent-1`
  const opening = await visitorClient.chat(run.channelId, { sessionId: session, runToken: run.token })
  const conversationId = opening.conversationId
  if (!conversationId) return check(`${label}: the widget opens a chat`, false, `HTTP ${opening.status}`)
  ctx.conversationIds.push(conversationId)
  const first = await visitorClient.chat(run.channelId, { sessionId: session, conversationId, message: text, messageId, runToken: run.token })
  check(`${label}: the bot answers it the first time`, first.status === 200 && !first.duplicate && first.text.trim().length > 0, first.text.slice(0, 200) || `HTTP ${first.status}`, conversationId)
  const again = await visitorClient.chat(run.channelId, { sessionId: session, conversationId, message: text, messageId, runToken: run.token })
  check(`${label}: the same message id is not answered twice`, again.status === 200 && again.duplicate && !again.text.trim(), again.duplicate ? undefined : again.text.slice(0, 200) || `HTTP ${again.status}`, conversationId)
  const messages = (await client.json<Array<{ authorKind?: string; text?: string; content?: { text?: string } }>>('GET', `/api/v1/conversations/${conversationId}/messages`)).data
  const copies = messages.filter((m) => m.authorKind === 'user' && (m.text ?? m.content?.text ?? '') === text).length
  check(`${label}: the Inbox shows it once`, copies === 1, `${copies} copies`, conversationId)
}

const GUARDRAIL_FIXTURES: Array<{ action: 'warn' | 'block' | 'redact' | 'escalate' | 'reask'; word: string }> = [
  { action: 'warn', word: 'zebrawarn' },
  { action: 'block', word: 'zebrablock' },
  { action: 'redact', word: 'zebraredact' },
  { action: 'escalate', word: 'zebraescalate' },
  { action: 'reask', word: 'zebrareask' },
]

/** Every guardrail action, through the bot's own safety test with throwaway rules; the live policy is not touched. */
async function guardrailActions(ctx: Ctx) {
  const { client, run, check } = ctx
  type Safety = { policies: Array<{ id: string; active: boolean }> }
  const safety = (await client.json<Safety>('GET', `/api/v1/bots/${run.botId}/safety`)).data
  const active = safety.policies.filter((p) => p.active).length
  check('Guardrails: at most one policy is active', active <= 1, `${active} active of ${safety.policies.length}`)

  type Decision = { outcome: string; text: string; hits: Array<{ action: string }>; line?: string }
  const rules = GUARDRAIL_FIXTURES.map(({ action, word }) => ({ id: `run-${action}`, name: `Run ${action}`, side: 'input', check: { kind: 'words', words: [word] }, action }))
  for (const { action, word } of GUARDRAIL_FIXTURES) {
    const text = `Tell me about ${word} please`
    const decision = (await client.json<{ guardrails: Decision }>('POST', `/api/v1/bots/${run.botId}/safety/test`, { text, side: 'input', rules })).data.guardrails
    const ok = action === 'warn' ? decision.outcome === 'allow' && decision.text === text && decision.hits.some((h) => h.action === 'warn')
      : action === 'redact' ? decision.outcome === 'allow' && !decision.text.includes(word) && decision.text.includes('[redacted]')
        : action === 'block' || action === 'reask' ? decision.outcome === action && Boolean(decision.line?.trim())
          : decision.outcome === 'escalate'
    check(`Guardrails: ${action === 'escalate' ? 'an' : 'a'} ${action} rule ${{ warn: 'lets the message through and records it', block: 'stops the message with a line', redact: 'hides the matched words', escalate: 'asks for a person', reask: 'asks the visitor to rephrase' }[action]}`, ok, `${decision.outcome}: ${decision.text}${decision.line ? ` / ${decision.line}` : ''}`)
  }
  const unset = (await client.json<{ guardrails: Decision }>('POST', `/api/v1/bots/${run.botId}/safety/test`, {
    text: 'zebranew', side: 'input', rules: [{ id: 'run-new', name: 'Run new rule', side: 'input', check: { kind: 'words', words: ['zebranew'] } }],
  })).data.guardrails
  check('Guardrails: a new rule without an action defaults to Warn', unset.outcome === 'allow' && unset.hits[0]?.action === 'warn', `${unset.outcome}, ${unset.hits.map((h) => h.action).join(', ')}`)
}

async function afterTraffic(ctx: Ctx, before: Overview | undefined, handedOver: string[]) {
  const { client, check, run, conversationIds } = ctx
  const list = (await client.json<Array<{ id: string; testRunId?: string | null }>>('GET', `/api/v1/conversations?botId=${run.botId}&limit=200`)).data
  const inInbox = conversationIds.filter((id) => list.some((row) => row.id === id))
  check('Every run chat appears in the Inbox list', inInbox.length === conversationIds.length, `${inInbox.length} of ${conversationIds.length}`)
  const flagged = list.filter((row) => conversationIds.includes(row.id) && row.testRunId === run.runId).length
  check('The Inbox marks run chats as test runs', flagged === inInbox.length, `${flagged} of ${inInbox.length}`)

  const after = await overview(client, run.botId)
  if (before && after) {
    const added = after.totalConversations - before.totalConversations
    check('Analytics counts every run chat', added === conversationIds.length, `${before.totalConversations} → ${after.totalConversations}, ${conversationIds.length} opened`)
    const escalated = (after.outcomes?.buckets?.escalated ?? 0) - (before.outcomes?.buckets?.escalated ?? 0)
    check('Analytics counts the handovers as escalated', escalated >= handedOver.length, `${escalated} new escalated, ${handedOver.length} handed over`)
    const o = after.outcomes
    if (o?.buckets && o.rates && o.finished !== undefined) {
      const { contained = 0, escalated: esc = 0, abandoned = 0 } = o.buckets
      const own = o.finished > 0 ? Math.round((esc / o.finished) * 1000) / 10 : null
      check('Analytics: escalation rate comes from escalated chats, not from containment', o.rates.escalated === own && contained + esc + abandoned === o.finished,
        `${esc} escalated of ${o.finished} finished = ${o.rates.escalated}%; contained ${o.rates.contained}%, abandoned ${o.rates.abandoned}%`)
    } else {
      check('Analytics: the overview reports outcome buckets', false, JSON.stringify(after.outcomes ?? null).slice(0, 300))
    }
  } else {
    check('Analytics overview answers', false, 'GET /analytics/overview failed')
  }
  const empty = await overview(client, `no-data-${run.runId}`)
  if (empty) {
    const values = { resolutionRate: empty.resolutionRate, escalationRate: empty.escalationRate, botHandledPct: empty.botHandledPct, ...empty.outcomes?.rates }
    const zeros = Object.entries(values).filter(([, value]) => value !== null).map(([key, value]) => `${key} ${value}`)
    check('Analytics: with no chats every rate is empty (a dash), never zero', empty.totalConversations === 0 && zeros.length === 0, zeros.join(', ') || undefined)
  }

  let compared = 0
  for (const id of conversationIds) {
    const convo = await conversation(client, id)
    if (!convo.llm || !convo.llm.calls) continue
    const rows = (await client.json<Array<{ costUsd: number | null }>>('GET', `/api/v1/analytics/llm-calls?conversationId=${id}&limit=500`)).data
    const sum = rows.reduce((total, row) => total + (row.costUsd ?? 0), 0)
    const ok = rows.length === convo.llm.calls && Math.abs(sum - (convo.llm.costUsd ?? 0)) < 1e-6
    compared++
    if (!ok) check('The Inbox cost equals the sum of the ledger rows', false, `${convo.llm.calls} calls $${convo.llm.costUsd} in the Inbox, ${rows.length} rows $${sum.toFixed(6)} in the ledger`, id)
  }
  if (compared) check('The Inbox cost equals the sum of the ledger rows', true, `${compared} chats with model calls`)
  await sleep(0)
}

async function releaseDrill(ctx: Ctx) {
  const { client, check, run, log } = ctx
  type Releases = { liveReleaseId: string | null; releases: Array<{ id: string; number: number; live: boolean }> }
  const releases = async () => (await client.json<Releases>('GET', `/api/v1/bots/${run.botId}/releases`)).data
  const start = await releases()
  const previous = start.releases.find((r) => r.live)
  check('Production plays a release', Boolean(previous), previous ? `release ${previous.number}` : 'Production plays the working copy')
  if (!previous) return

  const flows = (await client.json<Array<{ id: string; name: string; tags?: string[] }>>('GET', `/api/v1/bots/${run.botId}/flows`)).data
  const welcome = flows.find((f) => /welcome/i.test(f.name) || f.tags?.includes('entry')) ?? flows[0]
  if (!welcome) return check('The bot has a chapter to edit', false)
  const flow = (await client.json<{ versions: Array<{ version: number; graph: { nodes: Array<{ position?: { x: number; y: number } }>; edges: unknown[] }; variables?: unknown[] }> }>(
    'GET', `/api/v1/bots/${run.botId}/flows/${welcome.id}`,
  )).data
  const newest = flow.versions[0]
  if (!newest?.graph?.nodes?.length) return check(`"${welcome.name}" has steps`, false)
  const graph = structuredClone(newest.graph)
  const node = graph.nodes[0]!
  const x = node.position?.x ?? 0
  node.position = { x: x % 2 === 0 ? x + 1 : x - 1, y: node.position?.y ?? 0 }
  await client.json('PUT', `/api/v1/bots/${run.botId}/flows/${welcome.id}/versions/${newest.version}/canvas`, { graph, variables: newest.variables ?? [] })
  log(`  Moved the first step of "${welcome.name}" on the canvas`)

  const note = `Weekly release check ${new Date().toISOString().slice(0, 10)}: moved a step on the canvas, nothing patients hear changed.`
  const published = await client.json<{ releaseId: string; number: number; runs: Array<{ suiteName: string; status: string }> }>(
    'POST', `/api/v1/bots/${run.botId}/releases`, { note }, { allow: [409, 422] },
  )
  if (published.status !== 201) {
    const message = (published.data as unknown as { error?: { message?: string } })?.error?.message
    return check('Publishing passes the checks and the eval gate', false, message ?? `HTTP ${published.status}`)
  }
  const gate = published.data.runs ?? []
  check('Publishing passes the checks and the eval gate', gate.every((r) => r.status === 'passed'), `release ${published.data.number}; ${gate.map((r) => `${r.suiteName} ${r.status}`).join(', ') || 'no gate suites'}`)
  const afterPublish = await releases()
  check('The new release is live', afterPublish.liveReleaseId === published.data.releaseId, `live ${afterPublish.releases.find((r) => r.live)?.number}`)
  await greets(ctx, `after publishing release ${published.data.number}`)

  await client.json('POST', `/api/v1/bots/${run.botId}/releases/${previous.id}/rollback`, {})
  const rolledBack = await releases()
  check('Rollback makes the previous release live in one call', rolledBack.liveReleaseId === previous.id, `live ${rolledBack.releases.find((r) => r.live)?.number}`)
  await greets(ctx, `after rolling back to release ${previous.number}`)

  await client.json('POST', `/api/v1/bots/${run.botId}/releases/${published.data.releaseId}/rollback`, {})
  const forward = await releases()
  check('Rolling forward makes the new release live again', forward.liveReleaseId === published.data.releaseId)
  const old = forward.releases.find((r) => r.id === previous.id)
  check('Older releases are kept unchanged', Boolean(old) && old!.number === previous.number)
}

async function greets(ctx: Ctx, when: string) {
  const turn = await ctx.visitorClient.chat(ctx.run.channelId, { sessionId: `test-run-${ctx.run.runId}-${when.replace(/\W+/g, '-')}`, runToken: ctx.run.token })
  if (turn.conversationId) ctx.conversationIds.push(turn.conversationId)
  ctx.check(`The widget greets ${when}`, turn.status === 200 && turn.text.trim().length > 0, turn.text.slice(0, 120), turn.conversationId)
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}
