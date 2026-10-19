import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine } from './engine.js'
import type { FlowGraph } from './engine.js'
import type { ExecutionServices, Session } from './types.js'

function session(flow: Record<string, unknown>, global: Record<string, unknown> = {}): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow, global, contact: {} },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function machine(llm: Record<string, unknown> = {}) {
  return new SessionMachine({ llm, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
}

const say = (id: string, text: string) => ({ id, data: { kind: 'send_message', label: text, config: { text } } })
const end = { id: 'end', data: { kind: 'end_flow', label: 'End', config: {} } }

function routerGraph(routes: unknown[]): FlowGraph {
  return {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'router', data: { kind: 'route_topic', label: 'Router', config: { routes } } },
      say('vip', 'VIP desk'), say('book', 'Booking'), say('hours', 'Hours'), say('other', 'Anything else'), end,
    ],
    edges: [
      { id: 's', source: 'start', target: 'router' },
      { id: 'r-vip', source: 'router', target: 'vip', sourceHandle: 'vip' },
      { id: 'r-book', source: 'router', target: 'book', sourceHandle: 'book' },
      { id: 'r-hours', source: 'router', target: 'hours', sourceHandle: 'hours' },
      { id: 'r-other', source: 'router', target: 'other', sourceHandle: 'other' },
      ...['vip', 'book', 'hours', 'other'].map((id) => ({ id: `${id}-end`, source: id, target: 'end' })),
    ],
  }
}

const ROUTES = [
  { handle: 'vip', label: 'VIP desk', guard: { field: 'tier', operator: 'equals', value: 'gold' } },
  { handle: 'book', phrases: ['book', 'appointment'], intent: 'The guest wants an appointment', guard: { field: 'closed', operator: 'not_equals', value: 'yes' } },
  { handle: 'hours', label: 'Opening hours', intent: 'The guest asks when the salon is open' },
]

async function routed(text: string, flow: Record<string, unknown>, llm: Record<string, unknown> = {}) {
  const result = await machine(llm).run(session({ _last_user_message: text, ...flow }), routerGraph(ROUTES), text)
  return { line: result.newMessages[0]?.content.text, by: result.session.variables.flow['_route_by'] }
}

test('a rule-only route is decided by its rule before any words', async () => {
  assert.deepEqual(await routed('can I book a cut', { tier: 'gold' }), { line: 'VIP desk', by: 'rule' })
})

test('words pick a route only while its rule lets it, and the fallback takes the rest', async () => {
  assert.deepEqual(await routed('can I book a cut', {}), { line: 'Booking', by: 'words' })
  assert.deepEqual(await routed('can I book a cut', { closed: 'yes' }), { line: 'Anything else', by: 'fallback' })
})

test('the model picks among open routes only, reading each route intent', async () => {
  const asked: Array<{ categories: string[]; descriptions?: Record<string, string> }> = []
  const llm = {
    classify: async (_text: string, params: { categories: string[]; descriptions?: Record<string, string> }) => {
      asked.push(params)
      return { category: 'hours', confidence: 0.9 }
    },
  }
  assert.deepEqual(await routed('are you around on sunday', { closed: 'yes' }, llm), { line: 'Hours', by: 'model' })
  assert.deepEqual(asked[0]?.categories, ['hours', 'other'])
  assert.deepEqual(asked[0]?.descriptions, { hours: 'The guest asks when the salon is open' })
})

function scripted(replies: string[]) {
  const seen: Array<{ systemPrompt?: string; messages: Array<{ role: string; content: string }> }> = []
  return {
    seen,
    llm: {
      complete: async (params: { systemPrompt?: string; messages: Array<{ role: string; content: string }> }) => {
        seen.push(params)
        const content = replies.shift()
        if (content === undefined) throw new Error('no more replies')
        return { content, model: 'fake', inputTokens: 1, outputTokens: 1, durationMs: 1 }
      },
    },
  }
}

function askGraph(config: Record<string, unknown>): FlowGraph {
  return {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'ask', data: { kind: 'ask_question', label: 'Colour', config: { question: 'Which colour would you like?', variable: 'colour', ...config } } },
      say('thanks', 'Lovely, {{colour}} it is.'), say('limit', 'Let me pass you to a stylist.'), end,
    ],
    edges: [
      { id: 'a', source: 'start', target: 'ask' },
      { id: 'b', source: 'ask', target: 'thanks', sourceHandle: 'out' },
      { id: 'c', source: 'ask', target: 'limit', sourceHandle: 'max_turns' },
      { id: 'd', source: 'thanks', target: 'end' },
      { id: 'e', source: 'limit', target: 'end' },
    ],
  }
}

const AI_ASK = { mode: 'ai', goal: 'Find out which hair colour the guest wants', exitWhen: 'The guest names one colour', maxTurns: 3 }

test('an AI question talks until the exit condition is met, saves the answer and carries on', async () => {
  const { llm, seen } = scripted([
    '{"reply":"Which colour are you thinking of?","done":false}',
    '{"reply":"Warm or cool copper?","done":false}',
    '{"reply":"","done":true,"value":"warm copper"}',
  ])
  const bot = machine(llm)
  const graph = askGraph(AI_ASK)
  let result = await bot.run(session({ _last_user_message: 'I want a colour' }), graph, 'I want a colour')
  assert.equal(result.session.status, 'waiting_input')
  assert.deepEqual(result.newMessages.map((m) => m.content.text), ['Which colour are you thinking of?'])
  assert.match(seen[0]!.systemPrompt!, /Goal: Find out which hair colour/)
  assert.match(seen[0]!.systemPrompt!, /You have 3 replies left/)

  result = await bot.run(result.session, graph, 'copper')
  assert.deepEqual(result.newMessages.map((m) => m.content.text), ['Warm or cool copper?'])
  assert.deepEqual(seen[1]!.messages.map((m) => m.content), ['I want a colour', 'Which colour are you thinking of?', 'copper'])

  result = await bot.run(result.session, graph, 'warm please')
  assert.deepEqual(result.newMessages.map((m) => m.content.text), ['Lovely, warm copper it is.'])
  assert.equal(result.completed, true)
  assert.equal(result.session.variables.flow['colour'], 'warm copper')
  assert.deepEqual(result.session.variables.flow['_ai'], {})
})

test('an AI question that reaches its turn limit follows the turn-limit line', async () => {
  const { llm } = scripted([
    '{"reply":"Which colour?","done":false}',
    '{"reply":"Any shade in mind?","done":false}',
    '{"reply":"Shall I note blonde?","done":false}',
  ])
  const bot = machine(llm)
  const graph = askGraph(AI_ASK)
  let result = await bot.run(session({}), graph)
  result = await bot.run(result.session, graph, 'not sure')
  result = await bot.run(result.session, graph, 'hmm')
  assert.deepEqual(result.newMessages.map((m) => m.content.text), ['Let me pass you to a stylist.'])
  assert.equal(result.session.variables.flow['_ai_exit'], 'max_turns')
})

test('without a turn-limit line the step carries on along its line', async () => {
  const { llm } = scripted(['{"reply":"Copper is lovely this season.","done":false}'])
  const graph = askGraph({ ...AI_ASK, maxTurns: 1 })
  graph.edges = graph.edges.filter((edge) => edge.sourceHandle !== 'max_turns')
  const result = await machine(llm).run(session({}), graph)
  assert.equal(result.newMessages[0]?.content.text, 'Copper is lovely this season.')
  assert.match(result.newMessages[1]?.content.text ?? '', /^Lovely, /)
  assert.equal(result.completed, true)
})

test('when the model fails, an AI question falls back to asking it word for word', async () => {
  const { llm } = scripted([])
  const result = await machine(llm).run(session({}), askGraph(AI_ASK))
  assert.deepEqual(result.newMessages.map((m) => m.content.text), ['Which colour would you like?'])
  assert.equal(result.session.waitingFor?.variable, 'colour')
})

test('a model step saved before the contract still answers once and moves on', async () => {
  const graph: FlowGraph = {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'gen', data: { kind: 'llm_prompt', label: 'Answer', config: { prompt: 'Answer kindly' } } },
      end,
    ],
    edges: [{ id: 'a', source: 'start', target: 'gen' }, { id: 'b', source: 'gen', target: 'end' }],
  }
  const llm = { complete: async () => ({ content: 'Happy to help.', model: 'fake', inputTokens: 1, outputTokens: 1, durationMs: 1 }) }
  const result = await machine(llm).run(session({}), graph)
  assert.deepEqual(result.newMessages.map((m) => m.content.text), ['Happy to help.'])
  assert.equal(result.completed, true)
})
