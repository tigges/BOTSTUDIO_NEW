import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FlowGraph } from '@ybot/runtime'
import { DEFAULT_PRIVACY } from '@ybot/shared'
import { runTestTurn, type TestChatDeps } from './test-chat.js'
import { defaultToolDeps, runTool, type RunnableTool } from './tool-runner.js'

const quietModel = {
  classify: async () => ({ category: 'other', confidence: 0 }),
  embed: async () => ({ embeddings: [[]] }),
  complete: async () => ({ content: '' }),
  stream: async () => {},
}

const node = (id: string, kind: string, config: Record<string, unknown> = {}) => ({ id, data: { kind, label: id, config } })
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle ?? ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

function orderChart(toolId: string): FlowGraph {
  return {
    nodes: [
      node('start', 'start'),
      node('ask', 'ask_question', { question: 'What is your order number?', variable: 'order' }),
      node('tool', 'run_tool', { toolId, args: { order: '{{order}}' }, saveAs: 'order_info' }),
      node('found', 'send_message', { text: 'Order {{order}} is {{order_info.status}}.' }),
      node('failed', 'send_message', { text: 'I could not check that order right now.' }),
      node('end', 'end_flow'),
      node('end2', 'end_flow'),
    ],
    edges: [
      edge('start', 'ask'), edge('ask', 'tool'),
      edge('tool', 'found', 'success'), edge('tool', 'failed', 'error'),
      edge('found', 'end'), edge('failed', 'end2'),
    ],
  } as FlowGraph
}

const tools: Record<string, RunnableTool> = {
  lookup: {
    id: 'lookup', tenantId: 'tenant', botId: 'bot', name: 'lookup_order', kind: 'http', effect: 'read',
    parameters: [{ name: 'order', type: 'string', description: 'Order number', required: true }],
    config: { method: 'GET', url: 'https://shop.example.com/orders/{{order}}', retries: 0 },
    authProfile: null,
  },
  cancel: {
    id: 'cancel', tenantId: 'tenant', botId: 'bot', name: 'cancel_order', kind: 'http', effect: 'write',
    parameters: [{ name: 'order', type: 'string', description: 'Order number', required: true }],
    config: { method: 'POST', url: 'https://shop.example.com/orders/{{order}}/cancel' },
    authProfile: null,
  },
}

function deps(calls: string[]): Partial<TestChatDeps> {
  const fetch = (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ status: 'out for delivery' }), { headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return {
    handoverRules: async () => ({ liveAgents: false, alwaysHuman: [] }),
    answer: async () => {},
    llm: async () => quietModel as never,
    catalog: async () => undefined,
    safety: async () => ({ rules: [], privacy: DEFAULT_PRIVACY }),
    db: {},
    now: () => new Date('2026-10-19T12:00:00Z'),
    runTool: async (_tenantId, _botId, toolId, args) => {
      const tool = tools[toolId]
      if (!tool) return { name: 'unknown tool', ok: false, output: null, error: 'This tool is no longer in the Tools list.' }
      const result = await runTool(tool, args, { source: 'test_chat' }, defaultToolDeps({ fetch, checkUrl: async () => undefined, privacy: async () => DEFAULT_PRIVACY }))
      return { name: tool.name, ...result }
    },
  }
}

async function walk(toolId: string, calls: string[]) {
  const chapters = [{ name: 'Orders', graph: orderChart(toolId) }]
  const base = { tenantId: 'tenant', botId: 'bot', chapters, startChapter: 'Orders', environmentLabel: 'Sandbox', catalog: { facts: [] } }
  const open = await runTestTurn({ ...base, message: '' }, deps(calls))
  return runTestTurn({ ...base, message: 'A-1001', state: open.state }, deps(calls))
}

test('a Run tool step calls the tool with the answer and speaks its result', async () => {
  const calls: string[] = []
  const turn = await walk('lookup', calls)
  assert.deepEqual(calls, ['https://shop.example.com/orders/A-1001'])
  assert.match(turn.text, /Order A-1001 is out for delivery\./)
  assert.deepEqual(turn.tools, [{ toolId: 'lookup', name: 'lookup_order', ok: true, skipped: false }])
})

test('a test chat skips a tool that changes data and says so', async () => {
  const calls: string[] = []
  const turn = await walk('cancel', calls)
  assert.deepEqual(calls, [])
  assert.deepEqual(turn.tools, [{ toolId: 'cancel', name: 'cancel_order', ok: true, skipped: true }])
})

test('a Run tool step whose tool is gone follows the Error line', async () => {
  const turn = await walk('deleted', [])
  assert.match(turn.text, /could not check that order/)
  assert.equal(turn.tools[0]!.ok, false)
})
