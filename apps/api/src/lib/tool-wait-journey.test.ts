import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FlowGraph } from '@ybot/runtime'
import { runJourney } from './flow-runner.js'
import { newTestState, testJourneyStore, type TestChatDeps } from './test-chat.js'

const quietModel = {
  classify: async () => ({ category: 'other', confidence: 0 }),
  embed: async () => ({ embeddings: [[]] }),
  complete: async () => ({ content: '' }),
  stream: async () => {},
}

const deps: TestChatDeps = {
  handoverRules: async () => ({ liveAgents: false, alwaysHuman: [] }) as never,
  answer: async () => {},
  llm: async () => quietModel as never,
  catalog: async () => undefined,
  db: {},
  now: () => new Date('2026-10-19T12:00:00Z'),
  safety: async () => ({ rules: [], privacy: {} }) as never,
}

const diaryGraph: FlowGraph = {
  nodes: [
    { id: 'start', data: { kind: 'trigger_start', label: 'Start', config: {} } },
    { id: 'tool', data: { kind: 'run_tool', label: 'Check diary', config: { toolId: 'diary', saveAs: 'slots' } } },
    { id: 'done', data: { kind: 'send_message', label: 'Done', config: { text: 'Free: {{slots}}.' } } },
  ],
  edges: [
    { id: 'a', source: 'start', target: 'tool' },
    { id: 'b', source: 'tool', target: 'done', sourceHandle: 'success' },
  ],
} as never

async function turn(toolMs: number, waitSeconds: number | null) {
  const input = { tenantId: 't1', botId: 'bot1', chapters: [{ name: 'Welcome', graph: diaryGraph }], startChapter: 'Welcome', environmentLabel: 'Sandbox', message: '', catalog: { facts: [] } }
  const store = {
    ...testJourneyStore(input as never, newTestState(), deps),
    runTool: () => new Promise<{ ok: boolean; output: unknown }>((resolve) => setTimeout(() => resolve({ ok: true, output: 'Tue 10:00' }), toolMs)),
    toolWaitSeconds: async () => waitSeconds,
    toolName: async () => 'Diary lookup',
  }
  return runJourney(store as never, { conversationId: 'chat', botId: 'bot1', tenantId: 't1', userText: 'any slots?' })
}

test('Bot settings tool wait: a slow tool hands the chat over, naming the tool', async () => {
  const result = await turn(400, 0.05)
  assert.equal(result.handover?.priority, 'high')
  assert.deepEqual(result.handover?.tags, ['tool-wait'])
  assert.match(result.handover?.reason ?? '', /^Diary lookup did not answer within 0\.05 seconds/)
  assert.ok(!result.messages.some((line) => line.includes('Free:')))
})

test('Bot settings tool wait: a quick tool, or no wait set, answers as before', async () => {
  for (const wait of [5, null]) {
    const result = await turn(5, wait)
    assert.equal(result.handover, undefined)
    assert.ok(result.messages.some((line) => line.includes('Free: Tue 10:00.')), JSON.stringify(result.messages))
  }
})
