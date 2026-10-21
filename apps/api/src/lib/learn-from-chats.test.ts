import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionMachine, type FlowGraph } from '@botstudio/runtime'
import type { ExecutionServices, Session } from '@botstudio/runtime'
import {
  BELLA_SAMPLE,
  LEARNING_KEEPS,
  MIN_REPEAT,
  applyLearningRoute,
  graphKeepsLearning,
  hairStudioPack,
  inspectFlowGraph,
  suggestionFromRated,
  suggestionFromSamples,
  type RatedChatInput,
} from '@botstudio/shared'

function session(text: string, name = 'there'): Session {
  return {
    id: 's1',
    conversationId: 'c1',
    botId: 'b1',
    tenantId: 't1',
    flowId: 'f1',
    flowVersionId: 'v1',
    currentNodeId: 'start',
    variables: { flow: { _last_user_message: text }, global: {}, contact: { name } },
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function spoken(result: { newMessages: Array<{ content: { text?: string } }> }): string {
  return result.newMessages.map((message) => message.content.text ?? '').join('\n')
}

function winningHandle(text: string, routes: Array<{ handle: string; phrases: string[] }>): string {
  const hay = text.toLowerCase()
  let best: { handle: string; length: number } | undefined
  for (const route of routes) {
    for (const phrase of route.phrases) {
      const needle = phrase.toLowerCase()
      if (!needle || !hay.includes(needle)) continue
      if (!best || needle.length > best.length) best = { handle: route.handle, length: needle.length }
    }
  }
  return best?.handle ?? 'other'
}

function colourChats(count: number): RatedChatInput[] {
  return Array.from({ length: count }, () => ({
    rating: 1,
    visitorLines: ['Can I book a colour?'],
    botLines: ['What would you like done? A cut, colour, or something else is fine.'],
  }))
}

test('one helpful chat does not change the flow', () => {
  assert.equal(MIN_REPEAT, 3)
  assert.equal(suggestionFromRated(colourChats(1), 'Bella Hair Studio'), null)
  assert.equal(suggestionFromRated(colourChats(2), 'Bella Hair Studio'), null)
})

test('a repeated booking request becomes one unpublished draft', () => {
  const suggestion = suggestionFromRated(colourChats(7), 'Bella Hair Studio')
  assert.ok(suggestion)
  assert.equal(suggestion.phrase, 'book a colour')
  assert.equal(suggestion.sentence, 'People who already say “book a colour” skip the menu and go straight to the booking.')
  assert.equal(suggestion.fromLabel, 'From 7 helpful chats.')
  assert.equal(suggestion.keeps, LEARNING_KEEPS)
  assert.equal(suggestion.graph.nodes.some((node) => node.data.kind === 'end_flow'), true)
  assert.equal(JSON.stringify(suggestion.graph).includes('"status":"published"'), false)
})

test('the Bella sample skips the menu and keeps the greeting rules', async () => {
  const suggestion = suggestionFromSamples(BELLA_SAMPLE, 'Bella Hair Studio')
  assert.ok(suggestion)
  assert.equal(suggestion.phrase, 'book a colour')
  assert.equal(suggestion.fromLabel, 'From 1 sample chat.')
  assert.match(suggestion.preview[1]?.text ?? '', /Hi, I'm Bella at Bella Hair Studio/)
  assert.match(suggestion.preview[1]?.text ?? '', /I can book that/)
  assert.match(suggestion.preview[1]?.text ?? '', /What's your name\?/)
  assert.equal((suggestion.preview[1]?.text.match(/\?/g) ?? []).length, 1)
  const dumped = JSON.stringify(suggestion.graph)
  assert.equal(dumped.includes('Sophie'), false)
  assert.equal(dumped.includes('@'), false)
  assert.equal(dumped.includes('http'), false)
  assert.equal(dumped.includes('£20'), false)

  const issues = inspectFlowGraph(suggestion.graph, { flowNames: [] }).filter((issue) => issue.level === 'block' || issue.level === 'repair')
  assert.deepEqual(issues, [])
  const machine = new SessionMachine({ llm: {}, db: {}, httpFetch: fetch } as unknown as ExecutionServices)
  const graph = suggestion.graph as unknown as FlowGraph
  const unnamed = await machine.run(session('book a colour'), graph, 'book a colour')
  assert.equal(unnamed.session.status, 'waiting_input')
  assert.match(spoken(unnamed), /I can book that/)
  assert.match(spoken(unnamed), /What's your name\?/)
  assert.equal((spoken(unnamed).match(/\?/g) ?? []).length, 1)
  assert.equal(spoken(unnamed).includes('Sophie'), false)

  const known = await machine.run(session('book a colour', 'Ada'), graph, 'book a colour')
  assert.match(spoken(known), /been to us before/)
  assert.equal(spoken(known).includes("What's your name?"), false)
})

test('a sample drops a payment link, a deposit, and the visitor name', () => {
  const text = [
    'Visitor: Can I book a colour?',
    "Bella: Hi, I'm Bella at Bella Hair Studio.",
    'Bella: I can book that. Pay the £20 deposit at https://pay.example/deposit.',
    'Visitor: Sophie Turner',
    'Visitor: sophie@example.com',
    'Bella: Thanks Sophie Turner, use card details on the secure link.',
    'Bella: Have you been to us before?',
  ].join('\n')
  const suggestion = suggestionFromSamples(text, 'Bella Hair Studio')
  assert.ok(suggestion)
  const dumped = JSON.stringify(suggestion)
  assert.equal(dumped.includes('Sophie'), false)
  assert.equal(dumped.includes('sophie@'), false)
  assert.equal(dumped.includes('http'), false)
  assert.equal(dumped.includes('£20'), false)
  assert.equal(dumped.includes('card details'), false)
  assert.match(dumped, /Have you been to us before/)
})

test('the learned route wins book a colour and the pack route keeps a haircut', () => {
  const welcome = hairStudioPack('Bella Hair Studio').flows.find((flow) => flow.name === 'Salon welcome')!
  const patched = applyLearningRoute(welcome.graph as never, 'book a colour', 'Learned: book a colour')
  assert.equal(graphKeepsLearning(welcome.graph), false)
  assert.equal(graphKeepsLearning(patched), true)
  const names = [...hairStudioPack('Bella Hair Studio').flows.map((flow) => flow.name), 'Learned: book a colour']
  const issues = inspectFlowGraph(patched, { flowNames: names }).filter((issue) => issue.level === 'block' || issue.level === 'repair')
  assert.deepEqual(issues, [])
  const route = patched.nodes.find((node) => node.id === 'route')
  const routes = (route?.data.config['routes'] as Array<{ handle: string; phrases: string[] }>) ?? []
  assert.equal(winningHandle('Can I book a colour?', routes), 'learned-book-a-colour')
  assert.equal(winningHandle('book a haircut', routes), 'book-an-appointment')
  const again = applyLearningRoute(patched, 'book a colour', 'Learned: book a colour')
  assert.equal(again.edges.filter((edge) => edge.sourceHandle === 'learned-book-a-colour').length, patched.edges.filter((edge) => edge.sourceHandle === 'learned-book-a-colour').length)
})
