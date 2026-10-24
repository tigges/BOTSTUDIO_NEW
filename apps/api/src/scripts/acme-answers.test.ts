import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PRIVACY, inspectFlowGraph } from '@botstudio/shared'
import type { FlowGraph } from '@botstudio/runtime'
import { runTestTurn, type TestChatState } from '../lib/test-chat.js'
import { isPlaceholderChapter, paymentsChapter, supportChapter } from './acme-answers.js'

const note = (topic: string) => ({
  nodes: [
    { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'say', data: { kind: 'send_message', label: 'Answer', config: { text: `The pages did not state this for ${topic}. Edit the line to match Acme Support Bot.` } } },
    { id: 'end', data: { kind: 'end_flow', label: 'End', config: {} } },
  ],
  edges: [{ id: 'a', source: 'start', target: 'say' }, { id: 'b', source: 'say', target: 'end' }],
})

test('only a chapter that is still nothing but the import note counts as a placeholder', () => {
  assert.equal(isPlaceholderChapter(note('support')), true)
  const edited = note('support')
  edited.nodes[1]!.data.config.text = 'We answer support questions here.'
  assert.equal(isPlaceholderChapter(edited), false)
  assert.equal(isPlaceholderChapter(supportChapter()), false)
  assert.equal(isPlaceholderChapter(null), false)
})

test('the written chapters pass the publish check and answer in place, without a second jump', () => {
  for (const graph of [supportChapter(), paymentsChapter()]) {
    const blocks = inspectFlowGraph(graph).filter((issue) => issue.level === 'block' || issue.level === 'repair')
    assert.deepEqual(blocks, [])
    assert.equal(graph.nodes.some((node) => node.data.kind === 'execute_flow'), false)
  }
})

function welcome(): { name: string; graph: FlowGraph } {
  return {
    name: 'Welcome',
    graph: {
      nodes: [
        { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
        { id: 'ask', data: { kind: 'ask_question', label: 'Ask', config: { question: "Hi, I'm Cal from Acme. What can I help you with today?", variable: 'request' } } },
        { id: 'route', data: { kind: 'route_topic', label: 'Route', config: { routes: [
          { handle: 'support', label: 'Support', phrases: ['order', 'kettle', 'address', 'delivery'] },
          { handle: 'payments', label: 'Payments', phrases: ['invoice', 'seats'] },
        ] } } },
        { id: 'go-support', data: { kind: 'execute_flow', label: 'Support', config: { flowName: 'Support' } } },
        { id: 'go-payments', data: { kind: 'execute_flow', label: 'Payments', config: { flowName: 'Payments and identity' } } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask' },
        { id: 'e2', source: 'ask', target: 'route' },
        { id: 'e3', source: 'route', target: 'go-support', sourceHandle: 'support' },
        { id: 'e4', source: 'route', target: 'go-payments', sourceHandle: 'payments' },
      ],
    },
  }
}

const chapters = [
  welcome(),
  { name: 'Support', graph: supportChapter() as unknown as FlowGraph },
  { name: 'Payments and identity', graph: paymentsChapter() as unknown as FlowGraph },
]

async function chat(lines: string[]): Promise<string> {
  let state: TestChatState | undefined
  const said: string[] = []
  for (const message of ['', ...lines]) {
    const turn = await runTestTurn({
      tenantId: 'tenant', botId: 'bot', chapters, startChapter: 'Welcome', environmentLabel: 'Sandbox', message, catalog: { facts: [] }, state,
    }, {
      handoverRules: async () => ({ liveAgents: false, alwaysHuman: [] }),
      answer: async () => {},
      llm: async () => ({ classify: async () => ({ category: 'other', confidence: 0 }), embed: async () => ({ embeddings: [[]] }), complete: async () => ({ content: '' }), stream: async () => {} }) as never,
      catalog: async () => undefined,
      db: {},
      safety: async () => ({ rules: [], privacy: DEFAULT_PRIVACY }),
    })
    state = turn.state
    if (message) said.push(turn.text)
  }
  return said.join('\n')
}

test('the test-run visitors get answers about their order, return, invoice and address', async () => {
  const order = await chat(['Where is my order?', '1001'])
  assert.match(order, /delivery status/)
  assert.match(order, /order 1001/)
  assert.match(await chat(['The kettle in my order arrived cracked.']), /return, a replacement or a refund/)
  assert.match(await chat(['Our last invoice has two seats I do not recognise.']), /invoices, charges and billing/)
  assert.match(await chat(['I need to change the delivery address on my order.']), /delivery address before the order ships/)
  for (const reply of [order]) assert.doesNotMatch(reply, /did not state|Edit the line/)
})
