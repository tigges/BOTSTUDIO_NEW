import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type ExecutionServices, type FlowGraph, type Session } from '@botstudio/runtime'
import { runFlowTurn } from './flow-turn.js'

const services = {
  llm: {},
  db: {},
  httpFetch: fetch,
} as unknown as ExecutionServices

function session(currentNodeId: string, status: Session['status'] = 'running'): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId,
    variables: { flow: {}, global: {}, contact: { name: 'Guest' } },
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const welcome: FlowGraph = {
  nodes: [
    { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'hi', data: { kind: 'send_message', label: 'Welcome', config: { text: 'Welcome to Bella Hair Studio' } } },
    { id: 'ask', data: { kind: 'ask_question', label: 'Ask', config: { question: 'What do you need help with?', variable: 'topic' } } },
    { id: 'end', data: { kind: 'end_flow', label: 'End', config: {} } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'hi' },
    { id: 'e2', source: 'hi', target: 'ask' },
    { id: 'e3', source: 'ask', target: 'end' },
  ],
}

test('an unknown contact name is addressed as there', async () => {
  const machine = new SessionMachine(services)
  const named: FlowGraph = {
    nodes: [
      { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
      { id: 'hi', data: { kind: 'send_message', label: 'Welcome', config: { text: 'Hi {{contact.name}}! Welcome to Bella Hair Studio.' } } },
      { id: 'end', data: { kind: 'end_flow', label: 'End', config: {} } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'hi' },
      { id: 'e2', source: 'hi', target: 'end' },
    ],
  }
  const fresh = session('start')
  fresh.variables.contact = {}
  const result = await runFlowTurn(machine, fresh, named, 'start', 'hi')
  const text = result.newMessages.map((message) => message.content.text).join('\n')
  assert.match(text, /Hi there!/)
  assert.doesNotMatch(text, /\{\{contact\.name\}\}/)
})

test('a stuck follow-up starts the welcome flow again', async () => {
  const machine = new SessionMachine(services)
  const waiting = session('ask', 'waiting_input')
  waiting.waitingFor = { nodeId: 'ask', variable: 'topic', type: 'text' }

  const silent = await machine.run(waiting, welcome, 'order status')
  assert.equal(silent.newMessages.length, 0)

  const fresh = session('ask', 'waiting_input')
  fresh.waitingFor = { nodeId: 'ask', variable: 'topic', type: 'text' }
  const again = await runFlowTurn(machine, fresh, welcome, 'start', 'order status')
  const text = again.newMessages.map((message) => message.content.text).join('\n')
  assert.match(text, /Bella Hair Studio/)
  assert.match(text, /What do you need help with/)
})
