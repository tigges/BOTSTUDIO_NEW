import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hairStudioPack } from '@ybot/shared'
import type { FlowGraph } from '@ybot/runtime'
import { keepFirstQuestion, runCanvasPreview } from './preview-flow.js'

test('a chart test stops at the chapter boundary', async () => {
  const graph = hairStudioPack('Yuzu').flows.find((flow) => flow.name === 'Salon welcome')!.graph as unknown as FlowGraph
  const hello = await runCanvasPreview({ graph, message: 'where are you' })
  assert.match(hello.text, /What's your name\?/)
  const named = await runCanvasPreview({ graph, message: 'Ada', session: hello.session })
  assert.match(named.text, /This step continues in Location\./)
  assert.equal(named.text.includes('Rosewood'), false)
})

test('a second question is left for the next turn', () => {
  const stacked = "Great! I'd be happy to help you book a haircut. To get you scheduled, I'll need a few details: What day works best for you? Do you have a preferred time? Do you have a specific stylist?"
  const kept = keepFirstQuestion(stacked)
  assert.equal((kept.match(/\?/g) ?? []).length, 1)
  assert.match(kept, /What day works best for you\?/)
  assert.equal(kept.includes('stylist'), false)
  assert.equal(keepFirstQuestion("Hi, I'm Bella at Bella Hair Studio."), "Hi, I'm Bella at Bella Hair Studio.")
  assert.equal(keepFirstQuestion('Have you been to us before?'), 'Have you been to us before?')
})

test('the booking chart asks once, including a mistyped cut', async () => {
  const graph = hairStudioPack('Bella Hair Studio').flows.find((flow) => flow.name === 'Book an appointment')!.graph as FlowGraph
  const hello = await runCanvasPreview({ graph, message: 'hi' })
  assert.equal(hello.handled, true)
  assert.match(hello.text, /I can book that/)
  assert.match(hello.text, /What's your name\?/)
  assert.equal((hello.text.match(/\?/g) ?? []).length, 1)
  assert.equal(hello.text.includes('stylist'), false)

  const cut = await runCanvasPreview({ graph, message: 'wnat a cut', session: hello.session })
  assert.equal((cut.text.match(/\?/g) ?? []).length, 1)
  assert.match(cut.text, /been to us before/)
  assert.equal(cut.text.includes('preferred time'), false)
  assert.equal(cut.text.includes('stylist'), false)
  assert.equal(cut.session?.variables.flow['guest_name'], undefined)
  assert.equal(cut.text.toLowerCase().includes('wnat'), false)

  const slipped = await runCanvasPreview({ graph, message: 'wnat a ctu', session: hello.session })
  assert.equal((slipped.text.match(/\?/g) ?? []).length, 1)
  assert.match(slipped.text, /been to us before/)
  assert.equal(slipped.session?.variables.flow['guest_name'], undefined)
  assert.equal(slipped.session?.variables.contact['name'], 'there')

  const known = await runCanvasPreview({
    graph,
    message: 'wnat a ctu',
    session: {
      currentNodeId: 'b-start',
      status: 'running',
      variables: { flow: {}, global: {}, contact: { name: 'Ada' } },
    },
  })
  assert.equal((known.text.match(/\?/g) ?? []).length, 1)
  assert.match(known.text, /been to us before/)
  assert.equal(known.session?.variables.contact['name'], 'Ada')
  assert.equal(known.session?.variables.flow['guest_name'], undefined)
})
