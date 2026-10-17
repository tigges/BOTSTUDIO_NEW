import type { NodeContext, NodeResult } from '../types.js'
import { matchCatalog } from '../catalog-lookup.js'
import { matchTopic, pickTopic, type TopicRoute } from '../topic-route.js'
import { evaluateCondition, interpolate } from '../utils.js'

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
  const { config, session } = ctx
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
  const routes = (config['routes'] as TopicRoute[] | undefined) ?? []
  const heard = heardText(session)
  const fromLatest = matchTopic(heard.latest, routes)
  if (fromLatest !== 'other') return { output: { route: fromLatest }, nextNodeId: fromLatest }
  const fromTopic = matchTopic(heard.withTopic, routes)
  if (fromTopic !== 'other') return { output: { route: fromTopic }, nextNodeId: fromTopic }
  const handle = await pickTopic(heard.latest || heard.withTopic, routes, services.llm)
  return { output: { route: handle }, nextNodeId: handle }
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
    ?? matchCatalog(services.catalog, heard.latest, kind)
    ?? matchCatalog(services.catalog, heard.withTopic, kind)
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
  const { config } = ctx
  return {
    output: { handed_over: true },
    handover: { team: String(config['team'] ?? 'support'), priority: String(config['priority'] ?? 'medium'), note: String(config['note'] ?? '') },
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
    const results = await (services.db.$queryRawUnsafe as (sql: string, ...params: unknown[]) => Promise<Array<{ id: string; content: string; similarity: number }>>)(
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

// ── llm_generate ──────────────────────────────────────────────────────────────
export async function executeLlmGenerate(ctx: NodeContext): Promise<NodeResult> {
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
