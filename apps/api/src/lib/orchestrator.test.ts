import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aiStepContract,
  guardPasses,
  inspectFlowGraph,
  parseAiTurn,
  routeDecision,
  routerRoutes,
  stepMode,
} from '@botstudio/shared'

function routerFlow(routes: unknown[], extra: { fallback?: boolean } = {}) {
  return {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'router', data: { kind: 'route_topic', label: 'Router', config: { routes } } },
      { id: 'a', data: { kind: 'end_flow', label: 'Book', config: {} } },
      { id: 'b', data: { kind: 'end_flow', label: 'VIP desk', config: {} } },
      { id: 'c', data: { kind: 'end_flow', label: 'Anything else', config: {} } },
    ],
    edges: [
      { id: 's', source: 'start', target: 'router' },
      { id: 'r1', source: 'router', target: 'a', sourceHandle: 'book' },
      { id: 'r2', source: 'router', target: 'b', sourceHandle: 'vip' },
      ...(extra.fallback === false ? [] : [{ id: 'r3', source: 'router', target: 'c', sourceHandle: 'other' }]),
    ],
  }
}

test('router routes keep their order, read comma phrases and never include the fallback', () => {
  const routes = routerRoutes({
    routes: [
      { handle: 'vip', label: 'VIP desk', guard: { field: 'tier', operator: 'equals', value: 'gold' } },
      { handle: 'book', phrases: 'book, appointment , book', intent: 'The guest wants an appointment' },
      { handle: 'other', phrases: ['anything'] },
      { phrases: ['no handle'] },
    ],
  })
  assert.deepEqual(routes.map((route) => route.handle), ['vip', 'book'])
  assert.deepEqual(routes[1]?.phrases, ['book', 'appointment'])
  assert.equal(routes[1]?.label, 'book')
  assert.deepEqual(routes[0]?.guard, { field: 'tier', operator: 'equals', value: 'gold' })
})

test('a guard opens a route only when the value passes, and a broken guard keeps it shut', () => {
  const vars = { tier: 'gold', visits: '7', contact: { email: 'ana@example.com' } }
  assert.equal(guardPasses(undefined, vars), true)
  assert.equal(guardPasses({ field: 'tier', operator: 'equals', value: 'gold' }, vars), true)
  assert.equal(guardPasses({ field: 'flow.tier', operator: 'not_equals', value: 'gold' }, vars), false)
  assert.equal(guardPasses({ field: 'visits', operator: 'greater_than', value: '5' }, vars), true)
  assert.equal(guardPasses({ field: 'contact.email', operator: 'is_set', value: '' }, vars), true)
  assert.equal(guardPasses({ field: 'tier', operator: 'roughly', value: 'gold' }, vars), false)
  assert.equal(guardPasses({ field: '', operator: 'is_set', value: '' }, vars), false)
})

test('the canvas can say which part of a route is a rule and which part the model reads', () => {
  const [vip, book, plain] = routerRoutes({
    routes: [
      { handle: 'vip', label: 'VIP desk', guard: { field: 'tier', operator: 'equals', value: 'gold' } },
      { handle: 'book', phrases: ['book'], intent: 'Wants an appointment' },
      { handle: 'hours', label: 'Opening hours' },
    ],
  })
  assert.deepEqual(routeDecision(vip!), { rules: ['only when tier is gold'], model: '' })
  assert.deepEqual(routeDecision(book!), { rules: ['words: book'], model: 'Wants an appointment' })
  assert.deepEqual(routeDecision(plain!), { rules: [], model: 'the route name “Opening hours”' })
})

test('a router without a fallback cannot be published', () => {
  const issues = inspectFlowGraph(routerFlow([{ handle: 'book', phrases: ['book'] }, { handle: 'vip', phrases: ['vip'] }], { fallback: false }))
  const fallback = issues.find((issue) => issue.code === 'router-fallback')
  assert.equal(fallback?.level, 'block')
  assert.match(fallback?.message ?? '', /Router has no fallback\. Connect Other/)
})

test('a broken route rule blocks publishing and a route the model cannot read is noted', () => {
  const issues = inspectFlowGraph(routerFlow([
    { handle: 'book', guard: { field: 'tier', operator: 'equals', value: '' } },
    { handle: 'vip', label: 'VIP desk', guard: { field: 'tier', operator: 'roughly', value: 'gold' } },
  ]))
  const guards = issues.filter((issue) => issue.code === 'route-guard')
  assert.equal(guards.length, 2)
  assert.ok(guards.every((issue) => issue.level === 'block'))
  assert.match(guards[0]!.message, /checks tier but has no value/)
  assert.match(guards[1]!.message, /“VIP desk” uses “roughly”/)

  const plain = inspectFlowGraph(routerFlow([{ handle: 'book' }, { handle: 'vip', intent: 'Asks for the VIP desk' }]))
  const notes = plain.filter((issue) => issue.code === 'route-intent')
  assert.equal(notes.length, 1)
  assert.equal(notes[0]?.level, 'note')
  assert.equal(plain.some((issue) => issue.level === 'block'), false)
})

test('model steps are AI steps, Ask Question can switch, and an AI step needs a goal, exit condition and turn limit', () => {
  assert.equal(stepMode('llm_generate', {}), 'ai')
  assert.equal(stepMode('ask_question', {}), 'deterministic')
  assert.equal(stepMode('ask_question', { mode: 'ai' }), 'ai')
  assert.equal(stepMode('send_message', { mode: 'ai' }), 'deterministic')

  assert.deepEqual(aiStepContract({ goal: 'Find the colour', exitWhen: 'The guest names a colour', maxTurns: '4' }).missing, [])
  assert.deepEqual(aiStepContract({ goal: ' ', maxTurns: 40 }).missing, ['goal', 'exitWhen', 'maxTurns'])

  const graph = {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'ask', data: { kind: 'ask_question', label: 'Which colour?', config: { question: 'Which colour?', mode: 'ai', goal: 'Find the colour' } } },
      { id: 'end', data: { kind: 'end_flow', label: 'End', config: {} } },
    ],
    edges: [{ id: 'a', source: 'start', target: 'ask' }, { id: 'b', source: 'ask', target: 'end' }],
  }
  const issue = inspectFlowGraph(graph).find((item) => item.code === 'ai-step')
  assert.equal(issue?.level, 'block')
  assert.equal(issue?.message, 'Which colour? is an AI step and needs an exit condition and a turn limit (1 to 20).')
})

test("the model's turn is read from JSON, and prose counts as a reply that has not finished", () => {
  assert.deepEqual(parseAiTurn('{"reply":"Lovely, copper it is.","done":true,"value":"copper"}'), { reply: 'Lovely, copper it is.', done: true, value: 'copper' })
  assert.deepEqual(parseAiTurn('Sure: {"reply":"Which shade?","done":false}'), { reply: 'Which shade?', done: false })
  assert.deepEqual(parseAiTurn('Which shade would you like?'), { reply: 'Which shade would you like?', done: false })
})
