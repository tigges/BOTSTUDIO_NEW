import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guidedFlowGraph, starterFlows } from '@botstudio/shared'

test('a guided flow asks a question and can hand off', () => {
  const graph = guidedFlowGraph({ greeting: 'Hello', question: 'Order number?', handoff: true })
  const kinds = graph.nodes.map((node) => (node as { data: { kind: string } }).data.kind)
  assert.deepEqual(kinds, ['trigger_start', 'ask_question', 'ask_question', 'send_message', 'handover'])
})

test('a guided flow with no question ends after the greeting', () => {
  const graph = guidedFlowGraph({ greeting: 'Hello', question: '  ', handoff: false })
  const kinds = graph.nodes.map((node) => (node as { data: { kind: string } }).data.kind)
  assert.deepEqual(kinds, ['trigger_start', 'ask_question', 'end_flow'])
})

test('a blank guided greeting introduces the assistant and waits', () => {
  const graph = guidedFlowGraph({ greeting: '  ', question: "What's your name?", handoff: false })
  const opening = graph.nodes[1] as { data: { kind: string; config: { question: string } } }
  assert.equal(opening.data.kind, 'ask_question')
  assert.equal(opening.data.config.question, "Hi, I'm the assistant.")
})

test('every new company gets the same standard templates', () => {
  const names = starterFlows('Acme Corp').map((flow) => flow.name)
  assert.ok(names.includes('Welcome & Routing'))
  assert.ok(names.includes('Cancel order'))
  assert.ok(names.includes('Change address'))
  assert.ok(names.includes('Talk to a person'))
  assert.equal(new Set(names).size, names.length)
})
