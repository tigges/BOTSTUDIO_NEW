import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine } from './engine.js'
import type { FlowGraph } from './engine.js'
import type { ExecutionServices, Session } from './types.js'

function session(): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: {}, global: {}, contact: {} },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const graph: FlowGraph = {
  nodes: [
    { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'tool', data: { kind: 'run_tool', label: 'Check diary', config: { toolId: 'diary', saveAs: 'slots' } } },
    { id: 'done', data: { kind: 'send_message', label: 'Done', config: { text: 'Found {{slots}}.' } } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'tool' },
    { id: 'e2', source: 'tool', target: 'done', sourceHandle: 'success' },
  ],
}

function machine(delayMs: number, toolWaitSeconds: number | null): SessionMachine {
  return new SessionMachine({
    llm: {},
    db: {},
    httpFetch: fetch,
    toolWaitSeconds,
    toolName: async () => 'Diary lookup',
    runTool: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, output: '3 slots' }), delayMs)),
  } as unknown as ExecutionServices)
}

test('a tool slower than the wait hands the chat over and names the tool', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const running = machine(10_000, 3).run(session(), graph, 'any slots?')
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(3_000)
  const result = await running
  assert.equal(result.session.status, 'handed_over')
  assert.equal(result.session.variables.flow['tool_wait_escalated'], true)
  assert.equal(result.handover?.priority, 'high')
  assert.deepEqual(result.handover?.tags, ['tool-wait'])
  assert.match(result.handover?.reason ?? '', /^Diary lookup did not answer within 3 seconds/)
  assert.deepEqual(result.newMessages, [])
})

test('a tool that answers inside the wait takes the normal path', async () => {
  const result = await machine(5, 3).run(session(), graph, 'any slots?')
  assert.notEqual(result.session.status, 'handed_over')
  assert.equal(result.handover, undefined)
  assert.deepEqual(result.newMessages.map((message) => message.content.text), ['Found 3 slots.'])
})

test('with no wait set the bot waits for the tool', async () => {
  const result = await machine(20, null).run(session(), graph, 'any slots?')
  assert.equal(result.handover, undefined)
  assert.deepEqual(result.newMessages.map((message) => message.content.text), ['Found 3 slots.'])
})
