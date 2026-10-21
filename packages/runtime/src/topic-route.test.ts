import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from './engine.js'
import type { ExecutionServices, Session } from './types.js'
import { matchTopic, pickTopic } from './topic-route.js'

test('matchTopic picks the longest phrase', () => {
  const routes = [
    { handle: 'orders', phrases: ['order', 'where is'] },
    { handle: 'returns', phrases: ['return'] },
    { handle: 'cancel-order', phrases: ['cancel my order', 'cancellation'] },
  ]
  assert.equal(matchTopic('Where is my order?', routes), 'orders')
  assert.equal(matchTopic('I need to return a kettle', routes), 'returns')
  assert.equal(matchTopic('Please cancel my order', routes), 'cancel-order')
  assert.equal(matchTopic('hello', routes), 'other')
  assert.equal(matchTopic('wnat a ctu', [
    { handle: 'colour', phrases: ['colour', 'color', 'balayage', 'a colour'] },
    { handle: 'cut', phrases: ['haircut', 'a cut', 'a trim', 'trim', 'fringe'] },
    { handle: 'book', phrases: ['book'] },
  ]), 'cut')
  assert.equal(matchTopic('haricut', [
    { handle: 'cut', phrases: ['haircut', 'a cut'] },
    { handle: 'colour', phrases: ['colour'] },
  ]), 'cut')
  assert.equal(matchTopic('colur', [
    { handle: 'cut', phrases: ['haircut', 'a cut'] },
    { handle: 'colour', phrases: ['colour', 'color'] },
  ]), 'colour')
  assert.equal(matchTopic('cat', [
    { handle: 'cut', phrases: ['haircut', 'a cut', 'trim'] },
  ]), 'other')
  assert.equal(matchTopic('back', [
    { handle: 'book', phrases: ['book'] },
  ]), 'other')
  assert.equal(matchTopic('cut', [
    { handle: 'cut', phrases: ['haircut', 'a cut'] },
    { handle: 'colour', phrases: ['colour'] },
  ]), 'cut')
  assert.equal(matchTopic('services', [
    { handle: 'prices', phrases: ['how much', 'prices', 'services'] },
    { handle: 'book', phrases: ['book'] },
  ]), 'prices')
  assert.equal(matchTopic('men', [
    { handle: 'gents', phrases: ['gents wash, cut and style'] },
    { handle: 'ladies', phrases: ['ladies wash, cut and style'] },
  ]), 'gents')
  assert.equal(matchTopic('man', [
    { handle: 'gents', phrases: ['gents wash, cut and style'] },
    { handle: 'ladies', phrases: ['ladies wash, cut and style'] },
  ]), 'gents')
  assert.equal(matchTopic('ladies', [
    { handle: 'gents', phrases: ['gents wash, cut and style'] },
    { handle: 'ladies', phrases: ['ladies wash, cut and style'] },
  ]), 'ladies')
  assert.equal(
    matchTopic('Please change the delivery address', [
      { handle: 'orders', phrases: ['order', 'delivery'] },
      { handle: 'change-address', phrases: ['delivery address', 'change address'] },
    ]),
    'change-address',
  )
})

test('a route that hears more of the words wins over one longer word, and a slip counts half', () => {
  const telco = [
    { handle: 'sim', phrases: ['sim only deals', 'no contract sim', 'esim'] },
    { handle: 'cost', phrases: ['social tariff', 'help with cost of living', 'cheaper plans'] },
  ]
  assert.equal(matchTopic('What SIM only plans do you have?', telco), 'sim')
  assert.equal(matchTopic('cheaper plans please', telco), 'cost')
  const bbc = [
    { handle: 'complain', phrases: ['how do i complain to the bbc', 'where do i post a complaint'] },
    { handle: 'jobs', phrases: ['bbc vacancies', 'bbc jobs', 'freelance work bbc'] },
  ]
  assert.equal(matchTopic('Are there jobs at the BBC?', bbc), 'jobs')
  assert.equal(matchTopic('I want to complain', bbc), 'complain')
  const colour = [
    { handle: 'in-between-roots', phrases: ['in between roots', 'between', 'roots'] },
    { handle: 'roots', phrases: ['roots'] },
  ]
  assert.equal(matchTopic('How much are roots?', colour), 'roots')
  assert.equal(matchTopic('in-between roots please', colour), 'in-between-roots')
})

test('a phrase miss asks the model for one of this node\'s jobs', async () => {
  const routes = [
    { handle: 'plans', phrases: ['plans', 'sim only'] },
    { handle: 'hours', phrases: ['hours', 'open'] },
  ]
  assert.equal(await pickTopic('plans', routes, { classify: async () => ({ category: 'hours', confidence: 1 }) }), 'plans')
  assert.equal(
    await pickTopic('how much for unlimited data roaming', routes, {
      classify: async () => ({ category: 'plans', confidence: 0.9 }),
    }),
    'plans',
  )
  assert.equal(
    await pickTopic('hello', routes, {
      classify: async () => ({ category: 'other', confidence: 0.9 }),
    }),
    'other',
  )
  assert.equal(
    await pickTopic('how much for unlimited data roaming', routes, {
      classify: async () => ({ category: 'order_status', confidence: 1 }),
    }),
    'other',
  )
  assert.equal(await pickTopic('how much for unlimited data roaming', routes, {}), 'other')
  let called = false
  assert.equal(
    await pickTopic('plans', routes, {
      classify: async () => {
        called = true
        return { category: 'hours', confidence: 1 }
      },
    }),
    'plans',
  )
  assert.equal(called, false)
})

test('execute_flow hands off and route_topic selects a branch', async () => {
  const services = { llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices
  const machine = new SessionMachine(services)
  const graph: FlowGraph = {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'route', data: { kind: 'route_topic', label: 'Route', config: { routes: [{ handle: 'orders', phrases: ['order'] }] } } },
      { id: 'go', data: { kind: 'execute_flow', label: 'Order Status', config: { flowName: 'Order Status' } } },
      { id: 'hi', data: { kind: 'send_message', label: 'Hi', config: { text: 'How can I help?' } } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'route' },
      { id: 'e2', source: 'route', target: 'go', sourceHandle: 'orders' },
      { id: 'e3', source: 'route', target: 'hi', sourceHandle: 'other' },
    ],
  }
  const session: Session = {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: { _last_user_message: 'where is my order' }, global: {}, contact: { name: 'there' } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const jumped = await machine.run(session, graph, 'where is my order')
  assert.equal(jumped.jumpToFlow, 'Order Status')

  const greeting: Session = {
    ...session,
    id: 's2',
    currentNodeId: 'start',
    variables: { flow: { _last_user_message: 'hello' }, global: {}, contact: { name: 'there' } },
  }
  const welcomed = await machine.run(greeting, graph, 'hello')
  assert.equal(welcomed.jumpToFlow, undefined)
  assert.match(welcomed.newMessages.map((message) => message.content.text).join('\n'), /How can I help/)

  const thinking = { classify: async () => ({ category: 'orders', confidence: 0.8 }) }
  const classifiedMachine = new SessionMachine({ llm: thinking, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const asked = await classifiedMachine.run(
    {
      ...session,
      id: 's2b',
      currentNodeId: 'start',
      variables: { flow: { _last_user_message: 'where has my parcel got to' }, global: {}, contact: { name: 'there' } },
    },
    graph,
    'where has my parcel got to',
  )
  assert.equal(asked.jumpToFlow, 'Order Status')
})

test('a condition saved as true and false still takes the no branch', async () => {
  const services = { llm: {}, db: {}, httpFetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) } as unknown as ExecutionServices
  const machine = new SessionMachine(services)
  const graph: FlowGraph = {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'fetch', data: { kind: 'http_request', label: 'Fetch', config: { url: 'https://example.test/order' } } },
      { id: 'check', data: { kind: 'condition', label: 'Found?', config: { conditions: [{ field: 'status', operator: 'equals', value: '200' }] } } },
      { id: 'yes', data: { kind: 'send_message', label: 'Yes', config: { text: 'Found it' } } },
      { id: 'no', data: { kind: 'send_message', label: 'No', config: { text: 'Not found' } } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'fetch' },
      { id: 'e2', source: 'fetch', target: 'check' },
      { id: 'e3', source: 'check', target: 'yes', sourceHandle: 'true' },
      { id: 'e4', source: 'check', target: 'no', sourceHandle: 'false' },
    ],
  }
  const session: Session = {
    id: 's3',
    conversationId: 'c3',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: {}, global: {}, contact: { name: 'there' } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const result = await machine.run(session, graph, 'order 1')
  assert.match(result.newMessages.map((message) => message.content.text).join('\n'), /Not found/)
})

test('a booking sentence is not kept as the guest name', async () => {
  const services = { llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices
  const machine = new SessionMachine(services)
  const graph: FlowGraph = {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'ask', data: { kind: 'ask_question', label: 'Name', config: { question: "What's your name?", variable: 'guest_name' } } },
      { id: 'next', data: { kind: 'send_message', label: 'Next', config: { text: 'Have you been to us before?' } } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ask' },
      { id: 'e2', source: 'ask', target: 'next' },
    ],
  }
  const fresh = (): Session => ({
    id: 's4',
    conversationId: 'c4',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: {}, global: {}, contact: { name: 'there' } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const asked = await machine.run(fresh(), graph, 'hi')
  const slipped = await machine.run(asked.session, graph, 'wnat a cut')
  assert.equal(slipped.session.variables.flow['guest_name'], undefined)
  assert.match(slipped.newMessages.map((message) => message.content.text).join('\n'), /been to us before/)

  const askedAgain = await machine.run(fresh(), graph, 'hi')
  const named = await machine.run(askedAgain.session, graph, 'Sophie')
  assert.equal(named.session.variables.flow['guest_name'], 'Sophie')
})

test('the hair studio welcome sends cancel and move requests to their own chapters, not to booking', async () => {
  const { hairStudioPack, SALON_WELCOME_NAME } = await import('@botstudio/shared')
  const welcome = hairStudioPack('Bella Hair Studio').flows.find((flow) => flow.name === SALON_WELCOME_NAME)!
  const route = (welcome.graph as { nodes: Array<{ id: string; data: { config: { routes?: Array<{ handle: string; phrases: string[]; flowName: string }> } } }> })
    .nodes.find((node) => node.id === 'route')!.data.config.routes!
  const chapter = (text: string) => route.find((r) => r.handle === matchTopic(text, route))?.flowName
  assert.equal(chapter('I need to cancel my appointment tomorrow.'), 'Cancel appointment')
  assert.equal(chapter('Can I move my appointment to Friday?'), 'Reschedule')
  assert.equal(chapter('I want to book an appointment'), 'Book an appointment')
  assert.equal(chapter('how much is a haircut'), 'Services and prices')
})
