import type { NodeContext, NodeResult } from '../types.js'
import { pickCatalog } from '../catalog-lookup.js'
import { pickRoute } from '../topic-route.js'
import { aiStepContract, handoverFromConfig, parseAiTurn, routerRoutes, stepMode, toolWaitHandoverConfig, type AiStepContract } from '@botstudio/shared'
import { evaluateCondition, interpolate, lookup } from '../utils.js'

// ── trigger_start ────────────────────────────────────────────────────────────
export async function executeTriggerStart(_ctx: NodeContext): Promise<NodeResult> {
  return { output: {} }
}

// ── send_message ─────────────────────────────────────────────────────────────
export async function executeSendMessage(ctx: NodeContext): Promise<NodeResult> {
  const { config, session } = ctx
  const text = interpolate(String(config['text'] ?? ''), {
    ...session.variables.flow,
    ...session.variables.global,
    contact: session.variables.contact,
  })
  return {
    output: { sent: true },
    newMessages: [{ direction: 'outbound', content: { text } }],
  }
}

// ── ask_question ─────────────────────────────────────────────────────────────
export async function executeAskQuestion(ctx: NodeContext): Promise<NodeResult> {
  const ai = aiContract(ctx)
  if (ai) return executeAiStep(ctx, ai)
  return askVerbatim(ctx)
}

function compact(text: string): string {
  return text.toLowerCase().replace(/^(?:a|an|the|i'm|im)\s+/, '').replace(/[^a-z0-9]+/g, '')
}

/** The guest's latest message already names exactly one of the question's choices. */
export function choiceAlreadyHeard(choices: unknown, heard: string): string | undefined {
  if (!Array.isArray(choices) || !heard.trim()) return undefined
  const said = compact(heard)
  const named = choices.map(String).filter((choice) => {
    const core = compact(choice)
    return core.length >= 4 && said.includes(core)
  })
  return named.length === 1 ? named[0] : undefined
}

function askVerbatim(ctx: NodeContext): NodeResult {
  const { config, session } = ctx
  const variable = String(config['variable'] ?? 'answer')
  if (!String(session.variables.flow[variable] ?? '').trim()) {
    // Asking for what the guest just said sounds robotic: "I need a check-up" → "What is the visit for?"
    const known = choiceAlreadyHeard(config['choices'], String(session.variables.flow['_last_user_message'] ?? ''))
    if (known) return { output: { [variable]: known } }
  }
  const question = interpolate(String(config['question'] ?? ''), {
    ...session.variables.flow,
    contact: session.variables.contact,
  })
  return {
    output: {},
    newMessages: [{ direction: 'outbound', content: { text: question } }],
    waitForInput: {
      variable: String(config['variable'] ?? 'answer'),
      type: String(config['validate'] ?? 'text'),
      choices: config['choices'] as string[] | undefined,
      question,
    },
  }
}

// ── set_variable ──────────────────────────────────────────────────────────────
export async function executeSetVariable(ctx: NodeContext): Promise<NodeResult> {
  const { config, session } = ctx
  const variable = String(config['variable'] ?? '_')
  const raw = String(config['value'] ?? '')
  const value = interpolate(raw, { ...session.variables.flow, contact: session.variables.contact })
  return { output: { [variable]: value } }
}

// ── condition ─────────────────────────────────────────────────────────────────
export async function executeCondition(ctx: NodeContext): Promise<NodeResult> {
  const { config, session } = ctx
  const conditions = (config['conditions'] as Array<{ field: string; operator: string; value: string }>) ?? []
  const vars = { ...session.variables.flow, ...session.variables.global, contact: session.variables.contact }

  const met = conditions.every((c) =>
    evaluateCondition(c.field, c.operator as 'equals', c.value, vars as Record<string, unknown>),
  )

  return { output: { result: met ? 'yes' : 'no' }, nextNodeId: met ? 'yes' : 'no' }
}

// ── http_request ──────────────────────────────────────────────────────────────
export async function executeHttpRequest(ctx: NodeContext): Promise<NodeResult> {
  const { config, session, services } = ctx
  const url = interpolate(String(config['url'] ?? ''), { ...session.variables.flow, contact: session.variables.contact })
  const method = String(config['method'] ?? 'GET')

  try {
    const res = await services.httpFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...((config['headers'] as Record<string, string>) ?? {}) },
      ...(method !== 'GET' && config['body'] ? { body: JSON.stringify(config['body']) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    return { output: { status: res.status, data, ok: res.ok }, nextNodeId: res.ok ? 'success' : 'error' }
  } catch (err) {
    return { output: { status: 0, ok: false }, error: String(err), nextNodeId: 'error' }
  }
}

// ── run_tool ──────────────────────────────────────────────────────────────────
/** A value that is exactly one {{variable}} keeps its type; anything else is filled as text. */
function toolArg(template: string, vars: Record<string, unknown>): unknown {
  const single = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(template)
  if (single) return lookup(vars, single[1]!) ?? ''
  return interpolate(template, vars).replace(/\{\{[^}]+\}\}/g, '')
}

const TOOL_WAIT_EXPIRED = Symbol('tool-wait-expired')

/** The tool keeps running after the wait expires; its result is simply no longer awaited by this turn. */
async function withinToolWait<T>(call: Promise<T>, seconds: number): Promise<T | typeof TOOL_WAIT_EXPIRED> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<typeof TOOL_WAIT_EXPIRED>((resolve) => { timer = setTimeout(() => resolve(TOOL_WAIT_EXPIRED), seconds * 1000) })
  try {
    return await Promise.race([call, expired])
  } finally {
    clearTimeout(timer)
  }
}

export async function executeRunTool(ctx: NodeContext): Promise<NodeResult> {
  const { config, session, services } = ctx
  const toolId = String(config['toolId'] ?? '').trim()
  const saveAs = String(config['saveAs'] ?? '').trim() || 'tool_result'
  const vars = { ...session.variables.flow, ...session.variables.global, contact: session.variables.contact }
  const templates = (config['args'] && typeof config['args'] === 'object' ? config['args'] : {}) as Record<string, unknown>
  const args: Record<string, unknown> = {}
  for (const [name, template] of Object.entries(templates)) {
    const value = toolArg(String(template ?? ''), vars)
    if (value !== '' && value !== undefined && value !== null) args[name] = value
  }
  if (!toolId || !services.runTool) {
    return { output: { [saveAs]: null, tool_ok: false, tool_error: toolId ? 'Tools cannot run here.' : 'No tool chosen.' }, nextNodeId: 'error' }
  }
  const call = services.runTool(toolId, args)
  const seconds = services.toolWaitSeconds
  const result = seconds && seconds > 0 ? await withinToolWait(call, seconds) : await call
  if (result === TOOL_WAIT_EXPIRED) {
    const name = await services.toolName?.(toolId).catch(() => null) ?? null
    return {
      output: { [saveAs]: null, tool_ok: false, tool_error: `No answer within ${seconds} seconds.`, tool_wait_escalated: true },
      handover: handoverFromConfig(toolWaitHandoverConfig(name ?? '', seconds!), session.variables.flow),
    }
  }
  return {
    output: { [saveAs]: result.output ?? null, tool_ok: result.ok, tool_error: result.error ?? '', tool_skipped: result.skipped === true },
    nextNodeId: result.ok ? 'success' : 'error',
    ...(result.ok ? {} : { error: result.error }),
  }
}

// ── route_topic ───────────────────────────────────────────────────────────────
function heardText(session: NodeContext['session']): { latest: string; withTopic: string } {
  const topic = String(session.variables.flow['topic'] ?? '').trim()
  const last = String(session.variables.flow['_last_user_message'] ?? '').trim()
  const request = String(session.variables.flow['request'] ?? '').trim()
  const latest = request || last
  return { latest, withTopic: `${topic} ${latest}`.trim() }
}

export async function executeRouteTopic(ctx: NodeContext): Promise<NodeResult> {
  const { config, session, services } = ctx
  const vars = { ...session.variables.flow, ...session.variables.global, contact: session.variables.contact }
  const { handle, decidedBy } = await pickRoute(heardText(session), routerRoutes(config), vars, services.llm)
  return { output: { route: handle, _route_by: decidedBy }, nextNodeId: handle }
}

// ── execute_flow ──────────────────────────────────────────────────────────────
export async function executeExecuteFlow(ctx: NodeContext): Promise<NodeResult> {
  const flowName = String(ctx.config['flowName'] ?? '').trim()
  return { output: { jump: flowName }, jumpToFlow: flowName }
}

// ── lookup_catalog ────────────────────────────────────────────────────────────
export async function executeLookupCatalog(ctx: NodeContext): Promise<NodeResult> {
  const { config, session, services } = ctx
  const id = String(config['id'] ?? '').trim()
  const kind = String(config['kind'] ?? '').trim() || undefined
  const pinned = id ? services.catalog?.facts.find((fact) => fact.id === id) : undefined
  const heard = heardText(session)
  const hit = pinned
    ?? await pickCatalog(services.catalog, heard.latest, kind, services.llm)
    ?? await pickCatalog(services.catalog, heard.withTopic, kind, services.llm)
  if (!hit) return { output: { fact: '', catalog_title: '' }, nextNodeId: 'other' }
  return {
    output: { fact: hit.fact, catalog_title: hit.title, catalog_id: hit.id },
    nextNodeId: 'found',
  }
}

// ── classify_intent ───────────────────────────────────────────────────────────
export async function executeClassifyIntent(ctx: NodeContext): Promise<NodeResult> {
  const { session, services, config } = ctx
  const lastMsg = String((session.variables.flow['_last_user_message'] as string | undefined) ?? '')
  if (!lastMsg) return { output: { intent: 'unknown', confidence: 0 } }
  const rawCategories = config['categories']
  const configured = Array.isArray(rawCategories)
    ? rawCategories.map((item) => String(item).trim()).filter(Boolean)
    : typeof rawCategories === 'string' && rawCategories.trim().startsWith('[')
      ? (() => {
        try {
          const parsed = JSON.parse(rawCategories) as unknown
          return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : []
        } catch {
          return []
        }
      })()
      : []
  const categories = configured.length > 0
    ? configured
    : ['order_status', 'return_request', 'billing_query', 'password_reset', 'greeting', 'escalate_to_agent', 'other']
  const classify = services.llm?.classify
  if (typeof classify !== 'function') return { output: { intent: 'other', confidence: 0 } }
  const result = await classify(lastMsg, { categories })
  return { output: { intent: result.category, confidence: result.confidence } }
}

// ── handover ──────────────────────────────────────────────────────────────────
export async function executeHandover(ctx: NodeContext): Promise<NodeResult> {
  const { config, session } = ctx
  const vars = { ...session.variables.flow, contact: session.variables.contact }
  return {
    output: { handed_over: true },
    handover: handoverFromConfig(config, session.variables.flow, (text) => interpolate(text, vars)),
  }
}

// ── create_ticket ─────────────────────────────────────────────────────────────
export async function executeCreateTicket(ctx: NodeContext): Promise<NodeResult> {
  const { config, session } = ctx
  const vars = { ...session.variables.flow, contact: session.variables.contact }
  const subject = interpolate(String(config['subject'] ?? 'Support request'), vars)
  const description = interpolate(String(config['description'] ?? subject), vars)
  return { output: { ticket_created: true, subject }, ticket: { subject, description } }
}

// ── end_flow ──────────────────────────────────────────────────────────────────
export async function executeEndFlow(_ctx: NodeContext): Promise<NodeResult> {
  return { output: { completed: true } }
}

// ── search_knowledge ──────────────────────────────────────────────────────────
export async function executeSearchKnowledge(ctx: NodeContext): Promise<NodeResult> {
  const { config, session, services } = ctx
  const query = interpolate(String(config['query'] ?? session.variables.flow['last_user_message'] ?? ''), {
    ...session.variables.flow,
    contact: session.variables.contact,
  })
  try {
    // pgvector RAG query via the db service (requires vector extension and embedding column)
    const results = await services.db.$queryRawUnsafe<Array<{ id: string; content: string; similarity: number }>>(
      `SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
       FROM "DocumentChunk"
       WHERE tenant_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT 3`,
      JSON.stringify((await services.llm.embed({ texts: [query] })).embeddings[0] ?? []),
      session.tenantId,
    )
    if (results.length === 0) {
      const fallback = String(config['fallback'] ?? "I'm sorry, I couldn't find an answer to that. Let me connect you with an agent.")
      return { output: { answer: fallback, sources: [] }, newMessages: [{ direction: 'outbound', content: { text: fallback } }] }
    }
    const answer = results[0]!.content
    return { output: { answer, sources: results }, newMessages: [{ direction: 'outbound', content: { text: answer } }] }
  } catch {
    const fallback = String(config['fallback'] ?? "I'm sorry, I couldn't find an answer right now.")
    return { output: { answer: fallback, sources: [] }, newMessages: [{ direction: 'outbound', content: { text: fallback } }] }
  }
}

// ── AI steps ──────────────────────────────────────────────────────────────────
interface AiState {
  turns: number
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

const AI_STATE = '_ai'
const AI_HISTORY = 20

/** The goal, exit condition and turn limit, when this step runs as an AI step. Steps saved before the contract run as they always did. */
function aiContract(ctx: NodeContext): AiStepContract | undefined {
  if (stepMode(ctx.nodeKind, ctx.config) !== 'ai') return undefined
  const { contract, missing } = aiStepContract(ctx.config)
  return missing.length ? undefined : contract
}

function aiPrompt(contract: AiStepContract, turnsLeft: number, extra: { question?: string; variable?: string; instructions?: string }): string {
  return [
    'You lead one step of a chat for a business. Stay on this step.',
    `Goal: ${contract.goal}`,
    `The step is finished when: ${contract.exitWhen}`,
    extra.variable ? `When it is finished, put the guest's answer in "value". It is saved as ${extra.variable}.` : '',
    extra.question ? `If you still need the answer, this is the question to ask: ${extra.question}` : '',
    extra.instructions ? `Instructions: ${extra.instructions}` : '',
    'Ask one question at a time. Keep replies short and warm. Do not invent facts, prices or times. Do not offer promotions unless the guest asks.',
    `You have ${turnsLeft} ${turnsLeft === 1 ? 'reply' : 'replies'} left on this step.`,
    'Answer only with JSON: {"reply": "<what you say to the guest>", "done": <true once the step is finished>, "value": "<the answer, once finished>"}',
  ].filter(Boolean).join('\n')
}

/**
 * One turn of an AI step. The model talks toward the goal; the step waits for the guest
 * until the model says the exit condition is met or the turn limit is reached.
 * Done follows the step's line. The limit follows a "max_turns" line when there is one.
 */
export async function executeAiStep(ctx: NodeContext, contract: AiStepContract): Promise<NodeResult> {
  const { config, session, services, nodeId, nodeKind } = ctx
  const vars = { ...session.variables.flow, ...session.variables.global, contact: session.variables.contact }
  const saved = (session.variables.flow[AI_STATE] as Record<string, AiState> | undefined) ?? {}
  const state = saved[nodeId] ?? { turns: 0, history: [] }
  const rest = { ...saved }
  delete rest[nodeId]
  const asks = nodeKind === 'ask_question'
  const variable = asks ? String(config['variable'] ?? 'answer') : undefined
  const question = asks ? interpolate(String(config['question'] ?? ''), vars) : undefined
  const instructions = asks ? undefined : interpolate(String(config['prompt'] ?? config['systemPrompt'] ?? ''), vars).trim() || undefined

  const heard = (ctx.reply ?? (state.turns === 0 ? String(session.variables.flow['_last_user_message'] ?? '') : '')).trim()
  const history = heard ? [...state.history, { role: 'user' as const, content: heard }] : state.history
  const turns = state.turns + 1

  let content: string
  try {
    const result = await services.llm.complete({
      systemPrompt: aiPrompt(contract, contract.maxTurns - state.turns, { question, variable, instructions }),
      messages: history.length ? history : [{ role: 'user', content: '(The guest has not written yet.)' }],
      temperature: 0.3,
      maxTokens: 400,
    })
    content = result.content
  } catch {
    if (asks && state.turns === 0) return { ...askVerbatim(ctx), output: { [AI_STATE]: rest } }
    const text = "I'm having trouble right now. Let me get a human agent."
    return { output: { [AI_STATE]: rest, _ai_exit: 'error' }, newMessages: [{ direction: 'outbound', content: { text } }], nextNodeId: 'max_turns' }
  }

  const turn = parseAiTurn(content)
  const reply = turn.reply || (turn.done ? '' : question || 'Could you tell me a little more?')
  const say = (text: string) => (text ? [{ direction: 'outbound' as const, content: { text } }] : [])

  if (turn.done) {
    const output: Record<string, unknown> = { [AI_STATE]: rest, _ai_exit: 'done' }
    if (variable && turn.value) output[variable] = turn.value
    if (!asks) output['generated'] = reply
    return { output, newMessages: say(reply), nextNodeId: 'out' }
  }
  if (turns >= contract.maxTurns) {
    const closing = reply.trim().endsWith('?') ? '' : reply
    return {
      output: { [AI_STATE]: rest, _ai_exit: 'max_turns', ...(asks ? {} : { generated: closing }) },
      newMessages: say(closing),
      nextNodeId: 'max_turns',
    }
  }
  const next: AiState = { turns, history: [...history, { role: 'assistant' as const, content: reply }].slice(-AI_HISTORY) }
  return {
    output: { [AI_STATE]: { ...rest, [nodeId]: next } },
    newMessages: say(reply),
    waitForInput: { variable: '_ai_reply', type: 'ai', question: reply },
  }
}

// ── llm_generate ──────────────────────────────────────────────────────────────
export async function executeLlmGenerate(ctx: NodeContext): Promise<NodeResult> {
  const ai = aiContract(ctx)
  if (ai) return executeAiStep(ctx, ai)
  const { config, session, services, streamChunk } = ctx
  const systemPrompt = String(config['systemPrompt'] ?? 'You are a helpful assistant.')
  const prompt = interpolate(String(config['prompt'] ?? '{{flow.last_user_message}}'), {
    ...session.variables.flow,
    contact: session.variables.contact,
  })
  try {
    // Stream token-by-token if a streaming callback is wired and the provider supports it
    if (streamChunk && services.llm.stream) {
      let fullText = ''
      await services.llm.stream({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        onChunk: (chunk) => { fullText += chunk; streamChunk(chunk) },
      })
      const text = fullText || "I'm sorry, I couldn't generate a response."
      return { output: { generated: text }, newMessages: [{ direction: 'outbound', content: { text } }] }
    }

    const response = await services.llm.complete({ messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ] })
    const text = response.content ?? "I'm sorry, I couldn't generate a response."
    return { output: { generated: text }, newMessages: [{ direction: 'outbound', content: { text } }] }
  } catch {
    return { output: { generated: '' }, newMessages: [{ direction: 'outbound', content: { text: "I'm having trouble right now. Let me get a human agent." } }] }
  }
}
