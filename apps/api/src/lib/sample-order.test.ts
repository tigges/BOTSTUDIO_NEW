import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@botstudio/runtime'
import type { ExecutionServices, Session } from '@botstudio/runtime'
import { inspectFlowGraph, starterFlows, withSampleOrder, SAMPLE_ORDER_REPLY } from '@botstudio/shared'

function session(): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 's1',
    variables: { flow: {}, global: {}, contact: { name: 'Ada' } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function orderGraph() {
  const flow = starterFlows('Acme Corp').find((item) => item.name === 'Order Status')
  assert.ok(flow)
  return flow.graph as unknown as FlowGraph
}

test('order 1001 is answered and any other number still hands over', async () => {
  const graph = orderGraph()
  const issues = inspectFlowGraph(graph as Parameters<typeof inspectFlowGraph>[0], { flowNames: ['Order Status'] })
  assert.deepEqual(issues.filter((issue) => issue.level === 'block' || issue.level === 'repair'), [])

  const machine = new SessionMachine({
    llm: {},
    db: {},
    httpFetch: async () => { throw new Error('sample shop is offline') },
  } as unknown as ExecutionServices)

  const asked = await machine.run(session(), graph, 'where is my order')
  assert.match(asked.newMessages.map((message) => message.content.text).join('\n'), /1001/)
  assert.ok(asked.session.waitingFor)

  const sample = await machine.run(asked.session, graph, '1001')
  assert.match(sample.newMessages.map((message) => message.content.text).join('\n'), /on its way/)
  assert.equal(sample.handover, undefined)
  assert.equal(sample.session.status, 'completed')

  const again = await machine.run(session(), graph, 'where is my order')
  const other = await machine.run(again.session, graph, '9999')
  assert.ok(other.handover)
  assert.equal(other.newMessages.some((message) => message.content.text.includes(SAMPLE_ORDER_REPLY)), false)
})

test('an older order lookup gains the sample reply once', () => {
  const older = {
    nodes: [
      { id: 's1', type: 'flow-node', position: { x: 80, y: 120 }, data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 's2', type: 'flow-node', position: { x: 280, y: 120 }, data: { kind: 'ask_question', label: 'Ask', config: { question: 'Please share your order number so I can look it up.', variable: 'order_number' } } },
      { id: 's3', type: 'flow-node', position: { x: 480, y: 120 }, data: { kind: 'http_request', label: 'Fetch', config: { method: 'GET', url: 'https://api.acme.com/orders/{{order_number}}' } } },
      { id: 's4', type: 'flow-node', position: { x: 680, y: 120 }, data: { kind: 'condition', label: 'Found?', config: { conditions: [{ field: 'ok', operator: 'equals', value: 'true' }] } } },
      { id: 's6', type: 'flow-node', position: { x: 880, y: 200 }, data: { kind: 'handover', label: 'Hand over', config: { team: 'support' } } },
      { id: 's7', type: 'flow-node', position: { x: 1080, y: 120 }, data: { kind: 'end_flow', label: 'End', config: {} } },
    ],
    edges: [
      { id: 'e1', source: 's1', target: 's2' },
      { id: 'e2', source: 's2', target: 's3' },
      { id: 'e3', source: 's3', target: 's4' },
      { id: 'e5', source: 's4', sourceHandle: 'no', target: 's6' },
      { id: 'e4', source: 's4', sourceHandle: 'yes', target: 's7' },
      { id: 'e7', source: 's6', target: 's7' },
    ],
  }
  const first = withSampleOrder(older)
  assert.equal(first.changed, true)
  assert.equal(first.graph.edges.some((edge) => edge.source === 'sample-order' && edge.sourceHandle === 'yes' && edge.target === 'sample-reply'), true)
  assert.equal(first.graph.edges.some((edge) => edge.source === 'sample-order' && edge.sourceHandle === 'no' && edge.target === 's3'), true)
  assert.match(JSON.stringify(first.graph), /sample order is 1001/)
  const second = withSampleOrder(first.graph)
  assert.equal(second.changed, false)
})
